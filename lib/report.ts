// Server only. Reports are stored in the Spacefast database. The form secret
// and the Akismet key stay in the environment and are never written into a
// response or a log line.

import { clientKey, jsonNoStore, readLimitedBytes } from "./api";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";
import { rateLimit, retryAfterSeconds } from "./rate-limit";
import { readSpacefastDatabase, type ReportDatabase } from "./spacefast-db";
import { SITE_URL, USER_AGENT } from "./site";

type HeaderBag = { get(name: string): string | null };

const MAX_BODY = 32_768;
const MESSAGE_MAX = 2_000;
const URL_MAX = 2_000;
const PAGE_MAX = 500;
const EMAIL_MAX = 254;
const AGENT_MAX = 300;
const REFERRER_MAX = 2_000;
const REPORTS_PER_WINDOW = 5;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const MIN_FORM_MS = 3_000;
const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const AKISMET_URL = "https://rest.akismet.com/1.1/comment-check";

const THANKS = "Thanks, we got it.";
const NOT_SETUP = "Reporting is not set up right now.";
const SAVE_FAILED = "The report couldn't be saved. Try again in a moment.";
const TOO_MANY = "Too many reports. Try again later.";
const TOO_FAST = "Please wait a moment and try again.";
const STALE = "That form expired. Reload the page and try again.";
const UNREADABLE = "That report couldn't be read.";
const NEED_MESSAGE = "Describe what went wrong.";
const MESSAGE_LONG = "That report is too long.";
const BAD_EMAIL = "That email address isn't usable.";
const URL_LONG = "That URL is too long.";
const PAGE_LONG = "That page address is too long.";

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Spacefast passes a worker's statements to MySQL unchanged.
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS issue_reports (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at VARCHAR(40) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  page VARCHAR(500) NULL,
  url VARCHAR(2000) NULL,
  email VARCHAR(254) NULL,
  user_agent VARCHAR(300) NULL,
  spam_verdict VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL
)`;

const INSERT = `INSERT INTO issue_reports
  (created_at, message, page, url, email, user_agent, spam_verdict, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const readyTables = new WeakSet<object>();

export type ReportEnv = {
  formSecret?: string;
  akismetKey?: string;
  siteUrl?: string;
};

export type ReportDeps = {
  /** `null` means the database is absent. Omit it to read the Spacefast binding. */
  db?: ReportDatabase | null;
  fetch?: (input: string, options: SafeFetchOptions) => Promise<SafeResponse>;
  now?: () => number;
  /** When set, process.env is not read. */
  env?: ReportEnv;
};

type Verdict = "ham" | "spam" | "discard" | "unchecked";

function isControl(code: number): boolean {
  return code < 32 || code === 127;
}

function cleanText(value: string): string {
  let out = "";
  for (const char of value.replace(/\r\n?/g, "\n")) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 9) {
      out += char;
      continue;
    }
    if (isControl(code)) continue;
    out += char;
  }
  return out.trim();
}

function cleanHeader(value: string, max: number): string {
  let out = "";
  for (const char of value) {
    if (isControl(char.charCodeAt(0))) continue;
    out += char;
  }
  return out.trim().slice(0, max);
}

function asEmail(value: string): string | undefined {
  let cleaned = "";
  for (const char of value) {
    if (isControl(char.charCodeAt(0))) continue;
    cleaned += char;
  }
  cleaned = cleaned.trim();
  if (!cleaned || cleaned.length > EMAIL_MAX || !EMAIL.test(cleaned)) return undefined;
  return cleaned;
}

function usableSecret(value: string | undefined): string | undefined {
  const secret = value?.trim() ?? "";
  if (secret.length < 16 || secret.length > 200) return undefined;
  if ([...secret].some((char) => isControl(char.charCodeAt(0)) || char === " ")) return undefined;
  return secret;
}

function usableKey(value: string | undefined): string | undefined {
  const key = value?.trim() ?? "";
  if (!key || key.length > 200) return undefined;
  if ([...key].some((char) => isControl(char.charCodeAt(0)) || char === " ")) return undefined;
  return key;
}

function envOf(deps: ReportDeps): ReportEnv {
  if (deps.env) return deps.env;
  return {
    formSecret: process.env.REPORT_FORM_SECRET,
    akismetKey: process.env.AKISMET_API_KEY,
    siteUrl: process.env.SITE_URL || SITE_URL,
  };
}

function honeypotTripped(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value != null && value !== false;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A timestamp the server signed. Empty when the form secret is not set. */
export async function issueReportToken(now = Date.now(), secret = process.env.REPORT_FORM_SECRET): Promise<string> {
  const usable = usableSecret(secret);
  if (!usable) return "";
  return `${now}.${await hmacHex(usable, String(now))}`;
}

async function readToken(token: unknown, secret: string, now: number): Promise<"ok" | "fast" | "stale"> {
  if (typeof token !== "string") return "stale";
  const dot = token.indexOf(".");
  if (dot <= 0) return "stale";
  const issued = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d{10,16}$/.test(issued) || !/^[0-9a-f]{64}$/.test(mac)) return "stale";
  const expected = await hmacHex(secret, issued);
  if (!sameHex(expected, mac)) return "stale";
  const at = Number(issued);
  if (at > now + CLOCK_SKEW_MS) return "fast";
  const age = now - at;
  if (age < MIN_FORM_MS) return "fast";
  if (age > MAX_FORM_AGE_MS) return "stale";
  return "ok";
}

async function ensureTable(db: ReportDatabase): Promise<void> {
  if (readyTables.has(db)) return;
  await db.prepare(CREATE_TABLE).bind().run();
  readyTables.add(db);
}

async function akismetVerdict(
  fields: {
    key: string;
    siteUrl: string;
    ip: string;
    userAgent: string;
    referrer: string;
    message: string;
    email?: string;
  },
  fetch: ReportDeps["fetch"]
): Promise<Verdict> {
  const body = new URLSearchParams();
  body.set("api_key", fields.key);
  body.set("blog", fields.siteUrl);
  body.set("user_ip", fields.ip);
  body.set("user_agent", fields.userAgent || "unknown");
  body.set("referrer", fields.referrer);
  body.set("comment_type", "contact-form");
  body.set("comment_content", fields.message);
  if (fields.email) body.set("comment_author_email", fields.email);
  body.set("honeypot_field_name", "website");

  let response: SafeResponse;
  try {
    response = await (fetch ?? safeFetch)(AKISMET_URL, {
      method: "POST",
      body: body.toString(),
      userAgent: USER_AGENT,
      accept: "text/plain",
      allowedHosts: ["rest.akismet.com"],
      headers: { "content-type": "application/x-www-form-urlencoded" },
      timeoutMs: 8000,
      maxBytes: 16_000,
      maxRedirects: 0,
    });
  } catch {
    console.warn("[report] akismet check failed");
    return "unchecked";
  }
  if (response.status < 200 || response.status >= 300) {
    console.warn(`[report] akismet check failed status=${response.status}`);
    return "unchecked";
  }
  const tip = String(response.headers["x-akismet-pro-tip"] ?? "").trim().toLowerCase();
  if (tip === "discard") return "discard";
  const answer = response.body.trim().toLowerCase();
  if (answer === "true") return "spam";
  if (answer === "false") return "ham";
  return "unchecked";
}

export async function handleReport(
  req: { headers: HeaderBag; body: ReadableStream<Uint8Array> | null },
  deps: ReportDeps = {}
) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return jsonNoStore({ error: "Request is too large." }, 413);
  }
  const bytes = await readLimitedBytes(req.body, MAX_BODY);
  if (bytes === "too-large") return jsonNoStore({ error: "Request is too large." }, 413);

  const limitKey = `report:${clientKey(req)}`;
  if (!rateLimit(limitKey, REPORTS_PER_WINDOW, REPORT_WINDOW_MS)) {
    return jsonNoStore({ error: TOO_MANY }, 429, { "retry-after": String(retryAfterSeconds(limitKey)) });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonNoStore({ error: UNREADABLE }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: UNREADABLE }, 400);
  }

  if (honeypotTripped(body.website)) return jsonNoStore({ ok: true, message: THANKS });

  if (typeof body.message !== "string") return jsonNoStore({ error: NEED_MESSAGE }, 400);
  const message = cleanText(body.message);
  if (!message) return jsonNoStore({ error: NEED_MESSAGE }, 400);
  if (message.length > MESSAGE_MAX) return jsonNoStore({ error: MESSAGE_LONG }, 400);

  let page: string | undefined;
  if (body.page != null && body.page !== "") {
    if (typeof body.page !== "string") return jsonNoStore({ error: PAGE_LONG }, 400);
    page = cleanText(body.page);
    if (page.length > PAGE_MAX) return jsonNoStore({ error: PAGE_LONG }, 400);
    if (!page) page = undefined;
  }

  let url: string | undefined;
  if (body.url != null && body.url !== "") {
    if (typeof body.url !== "string") return jsonNoStore({ error: URL_LONG }, 400);
    url = cleanText(body.url);
    if (url.length > URL_MAX) return jsonNoStore({ error: URL_LONG }, 400);
    if (!url) url = undefined;
  }

  let email: string | undefined;
  if (body.email != null && body.email !== "") {
    if (typeof body.email !== "string") return jsonNoStore({ error: BAD_EMAIL }, 400);
    const cleaned = asEmail(body.email);
    if (!cleaned && body.email.trim() === "") email = undefined;
    else if (!cleaned) return jsonNoStore({ error: BAD_EMAIL }, 400);
    else email = cleaned;
  }

  const settings = envOf(deps);
  const secret = usableSecret(settings.formSecret);
  if (!secret) return jsonNoStore({ error: NOT_SETUP }, 503);
  const now = (deps.now ?? Date.now)();
  const token = await readToken(body.token, secret, now);
  if (token === "fast") return jsonNoStore({ error: TOO_FAST }, 400);
  if (token === "stale") return jsonNoStore({ error: STALE }, 400);

  const db = deps.db === null ? undefined : (deps.db ?? readSpacefastDatabase());
  if (!db) {
    console.warn("[report] database unavailable");
    return jsonNoStore({ error: SAVE_FAILED }, 502);
  }

  const userAgent = cleanHeader(req.headers.get("user-agent") ?? "", AGENT_MAX);
  const referrer = cleanHeader(req.headers.get("referer") ?? "", REFERRER_MAX);
  const akismetKey = usableKey(settings.akismetKey);
  const siteUrl = settings.siteUrl?.trim() || SITE_URL;
  let verdict: Verdict = "unchecked";
  if (akismetKey && /^https?:\/\//.test(siteUrl)) {
    verdict = await akismetVerdict(
      {
        key: akismetKey,
        siteUrl,
        ip: clientKey(req),
        userAgent,
        referrer,
        message: [message, "", `Page: ${page ?? ""}`, `Link: ${url ?? ""}`].join("\n"),
        email,
      },
      deps.fetch
    );
  }
  if (verdict === "discard") return jsonNoStore({ ok: true, message: THANKS });

  try {
    await ensureTable(db);
    await db.prepare(INSERT).bind(
      new Date(now).toISOString(),
      message,
      page ?? null,
      url ?? null,
      email ?? null,
      userAgent || null,
      verdict,
      verdict === "spam" ? "spam" : "new"
    ).run();
  } catch {
    console.warn("[report] save failed");
    return jsonNoStore({ error: SAVE_FAILED }, 502);
  }
  return jsonNoStore({ ok: true, message: THANKS });
}
