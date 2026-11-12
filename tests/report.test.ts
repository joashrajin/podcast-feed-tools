import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { handleDbCheck } from "../lib/dbcheck";
import { rateLimit } from "../lib/rate-limit";
import { handleReport, issueReportToken, type ReportDeps, type ReportEnv } from "../lib/report";
import type { ReportDatabase } from "../lib/spacefast-db";
import type { SafeFetchOptions, SafeResponse } from "../lib/net";

const SECRET = "test-form-secret-value";
const AKISMET = "akismet-test-key-not-real";
const NOW = 1_700_000_000_000;
const env: ReportEnv = { formSecret: SECRET, akismetKey: AKISMET, siteUrl: "https://podcast.example" };

type Stored = { sql: string; args: unknown[] };

function memoryDb(failCreate = false) {
  const statements: Stored[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (failCreate && sql.startsWith("CREATE")) throw new Error("create refused");
              statements.push({ sql, args });
            },
            async first() {
              return { ok: 1 };
            },
          };
        },
      };
    },
  } as ReportDatabase;
  return { db, statements };
}

function akismet(body: string, headers: Record<string, string> = {}, status = 200) {
  const calls: { url: string; options: SafeFetchOptions }[] = [];
  const fetch = async (url: string, options: SafeFetchOptions) => {
    calls.push({ url, options });
    const response: SafeResponse = { url, status, headers, body };
    return response;
  };
  return { fetch, calls };
}

function posted(body: unknown, ip: string, userAgent = "TestBrowser/1.0") {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      "user-agent": userAgent,
      referer: "https://podcast.example/",
    },
    body: raw,
  });
}

async function form(extra: Record<string, unknown> = {}, age = 10_000) {
  return {
    message: "The Apple link came back unreadable.",
    page: "/tools",
    url: "https://feeds.example.com/show.xml",
    email: "ada@example.com",
    website: "",
    token: await issueReportToken(NOW - age, SECRET),
    ...extra,
  };
}

async function submit(body: unknown, ip: string, deps: ReportDeps = {}) {
  const database = deps.db === undefined ? memoryDb().db : deps.db;
  return handleReport(posted(body, ip), { now: () => NOW, env, db: database, ...deps });
}

function inserts(statements: Stored[]) {
  return statements.filter((statement) => statement.sql.startsWith("INSERT"));
}

async function visible(res: Response) {
  const headers = [...res.headers.entries()].map(([name, value]) => `${name}: ${value}`).join("\n");
  return `${res.status}\n${headers}\n${await res.clone().text()}`;
}

describe("issue reports", () => {
  it("stores a ham report and answers the same thanks it gives spam", async () => {
    const store = memoryDb();
    const check = akismet("false");
    const res = await submit(await form(), "203.0.113.10", { db: store.db, fetch: check.fetch });
    assert.equal(res.status, 200);
    const shown = await visible(res);
    assert.match(shown, /Thanks, we got it/);
    assert.equal(shown.includes(AKISMET), false);
    assert.equal(shown.includes(SECRET), false);
    const row = inserts(store.statements)[0];
    assert.equal(row.args[1], "The Apple link came back unreadable.");
    assert.equal(row.args[6], "ham");
    assert.equal(row.args[7], "new");
    assert.equal(row.args[5], "TestBrowser/1.0");
    const sent = new URLSearchParams(check.calls[0].options.body);
    assert.equal(check.calls[0].url, "https://rest.akismet.com/1.1/comment-check");
    assert.deepEqual(check.calls[0].options.allowedHosts, ["rest.akismet.com"]);
    assert.equal(sent.get("api_key"), AKISMET);
    assert.equal(sent.get("blog"), "https://podcast.example");
    assert.equal(sent.get("user_ip"), "203.0.113.10");
    assert.equal(sent.get("comment_type"), "contact-form");
    assert.equal(sent.get("comment_author_email"), "ada@example.com");
    assert.equal(sent.get("honeypot_field_name"), "website");
    assert.equal(sent.get("user_agent"), "TestBrowser/1.0");
  });

  it("stores Akismet spam, drops a discard tip, and keeps an outage as unchecked", async () => {
    const spam = memoryDb();
    const spamCheck = akismet("true");
    const spamRes = await submit(await form(), "203.0.113.11", { db: spam.db, fetch: spamCheck.fetch });
    const spamBody = await spamRes.text();
    assert.equal(spamRes.status, 200);
    assert.equal(inserts(spam.statements)[0].args[6], "spam");
    assert.equal(inserts(spam.statements)[0].args[7], "spam");

    const discarded = memoryDb();
    const discardCheck = akismet("true", { "x-akismet-pro-tip": "discard" });
    const discardRes = await submit(await form(), "203.0.113.12", { db: discarded.db, fetch: discardCheck.fetch });
    const discardBody = await discardRes.text();
    assert.equal(discardRes.status, 200);
    assert.match(discardBody, /Thanks, we got it/);
    assert.equal(inserts(discarded.statements).length, 0);

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const kept = memoryDb();
      const down = akismet(`error ${AKISMET}`, {}, 503);
      const downRes = await submit(await form(), "203.0.113.13", { db: kept.db, fetch: down.fetch });
      assert.equal(downRes.status, 200);
      assert.equal(inserts(kept.statements)[0].args[6], "unchecked");
      assert.equal(inserts(kept.statements)[0].args[7], "new");
      const shown = await visible(downRes);
      assert.equal(shown.includes(AKISMET), false);
      assert.equal(warnings.join("\n").includes(AKISMET), false);
    } finally {
      console.warn = original;
    }

    const plain = memoryDb();
    const unset = akismet("false");
    const unsetRes = await submit(await form(), "203.0.113.14", {
      db: plain.db,
      fetch: unset.fetch,
      env: { formSecret: SECRET, siteUrl: "https://podcast.example" },
    });
    assert.equal(unsetRes.status, 200);
    assert.equal(unset.calls.length, 0);
    assert.equal(inserts(plain.statements)[0].args[6], "unchecked");
    assert.equal(spamBody, discardBody);
    assert.equal(discardBody, await unsetRes.text());
  });

  it("drops a filled honeypot without writing a row", async () => {
    const store = memoryDb();
    const res = await submit(await form({ website: "http://spam.test", token: "forged" }), "203.0.113.15", {
      db: store.db,
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Thanks, we got it/);
    assert.equal(store.statements.length, 0);
  });

  it("requires a signed token that is a few seconds old and not hours old", async () => {
    const fresh = await submit(await form({}, 0), "203.0.113.16");
    assert.equal(fresh.status, 400);
    assert.match(await fresh.text(), /wait a moment/);

    const old = await submit(await form({}, 13 * 60 * 60 * 1000), "203.0.113.17");
    assert.equal(old.status, 400);
    assert.match(await old.text(), /expired/);

    const forged = await form();
    forged.token = `${forged.token.slice(0, -1)}${forged.token.endsWith("0") ? "1" : "0"}`;
    const rejected = await submit(forged, "203.0.113.18");
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /expired/);

    const missing = await submit(await form(), "203.0.113.19", { env: { akismetKey: AKISMET } });
    assert.equal(missing.status, 503);
    const shown = await visible(missing);
    assert.match(shown, /not set up/);
    assert.equal(shown.includes("REPORT_FORM_SECRET"), false);
    assert.equal(shown.includes("AKISMET"), false);
    assert.equal(shown.includes(SECRET), false);
  });

  it("strips control characters and refuses a stuffed email address", async () => {
    const store = memoryDb();
    const check = akismet("false");
    const res = await submit(
      await form({ message: "line\u0000one\r\nline\ttwo" }),
      "203.0.113.20",
      { db: store.db, fetch: check.fetch }
    );
    assert.equal(res.status, 200);
    assert.equal(inserts(store.statements)[0].args[1], "lineone\nline\ttwo");

    const injected = await submit(await form({ email: "ada@example.com\r\nBcc: x@evil.test" }), "203.0.113.21");
    assert.equal(injected.status, 400);
    assert.match(await injected.text(), /isn't usable/);
  });

  it("requires a message and caps its length and the user agent", async () => {
    const empty = await submit(await form({ message: "  \n  " }), "203.0.113.22");
    assert.equal(empty.status, 400);
    assert.match(await empty.text(), /Describe what went wrong/);

    const store = memoryDb();
    const ok = await submit(await form({ message: "a".repeat(2000) }), "203.0.113.23", {
      db: store.db,
      fetch: akismet("false").fetch,
    });
    assert.equal(ok.status, 200);

    const over = await submit(await form({ message: `a${"b".repeat(2000)}` }), "203.0.113.24");
    assert.equal(over.status, 400);
    assert.match(await over.text(), /too long/);

    const agent = memoryDb();
    const longAgent = `Bot/${"x".repeat(400)}`;
    await handleReport(posted(await form(), "203.0.113.25", longAgent), {
      now: () => NOW,
      env,
      db: agent.db,
      fetch: akismet("false").fetch,
    });
    const saved = String(inserts(agent.statements)[0].args[5]);
    assert.equal(saved.startsWith("Bot/"), true);
    assert.equal(saved.length, 300);
    assert.equal(saved.length < longAgent.length, true);
  });

  it("allows five reports an hour from one address, then refuses", async () => {
    const store = memoryDb();
    const fetch = akismet("false").fetch;
    const ip = "203.0.113.30";
    for (let n = 0; n < 5; n += 1) {
      const res = await submit(await form({ message: `Report ${n}` }), ip, { db: store.db, fetch });
      assert.equal(res.status, 200);
    }
    const blocked = await submit(await form(), ip, { db: store.db, fetch });
    assert.equal(blocked.status, 429);
    const shown = await visible(blocked);
    assert.match(shown, /Too many reports/);
    assert.equal(shown.includes(AKISMET), false);
    assert.equal(inserts(store.statements).length, 5);

    const other = memoryDb();
    const next = await submit(await form(), "203.0.113.31", { db: other.db, fetch });
    assert.equal(next.status, 200);
  });

  it("creates the MySQL table before the first insert", async () => {
    const store = memoryDb();
    const res = await submit(await form(), "203.0.113.32", { db: store.db, fetch: akismet("false").fetch });
    assert.equal(res.status, 200);
    assert.match(store.statements[0].sql, /^CREATE TABLE IF NOT EXISTS issue_reports[\s\S]*AUTO_INCREMENT/);
    assert.equal(store.statements[1].sql.startsWith("INSERT"), true);
  });

  it("says the report could not be saved when the table can't be created", async () => {
    const store = memoryDb(true);
    const res = await submit(await form(), "203.0.113.35", { db: store.db, fetch: akismet("false").fetch });
    assert.equal(res.status, 502);
    assert.match(await visible(res), /couldn't be saved/);
    assert.equal(store.statements.length, 0);
  });

  it("says the report could not be saved when the database binding is absent", async () => {
    const res = await submit(await form(), "203.0.113.33", { db: null, fetch: akismet("false").fetch });
    assert.equal(res.status, 502);
    const shown = await visible(res);
    assert.match(shown, /couldn't be saved/);
    assert.equal(shown.includes("env.DB"), false);
    assert.equal(shown.includes(AKISMET), false);
  });

  it("caps the body", async () => {
    const raw = JSON.stringify({ message: "m".repeat(40_000), token: "x" });
    const res = await handleReport(posted(raw, "203.0.113.34"), { now: () => NOW, env, db: null });
    assert.equal(res.status, 413);
  });

  it("keeps the ordinary per-minute limit at 20", () => {
    const key = `plain-${NOW}`;
    for (let n = 0; n < 20; n += 1) assert.equal(rateLimit(key), true);
    assert.equal(rateLimit(key), false);
  });

  it("answers the database probe only to the token, and only with two booleans", async () => {
    const token = "dbcheck-token-value";
    const closed = await handleDbCheck(
      new Request("http://localhost/api/dbcheck", { headers: { "x-dbcheck-token": token } }),
      { token: "" }
    );
    assert.equal(closed.status, 404);
    assert.equal(await closed.text(), "");

    const wrong = await handleDbCheck(
      new Request("http://localhost/api/dbcheck", { headers: { "x-dbcheck-token": "nope-nope-nope-no" } }),
      { token }
    );
    assert.equal(wrong.status, 404);

    const open = await handleDbCheck(
      new Request("http://localhost/api/dbcheck", { headers: { "x-dbcheck-token": token } }),
      { token, db: memoryDb().db }
    );
    assert.equal(open.status, 200);
    assert.deepEqual(await open.json(), { db: true, select1: true });

    const absent = await handleDbCheck(
      new Request("http://localhost/api/dbcheck", { headers: { "x-dbcheck-token": token } }),
      { token, db: null }
    );
    const body = await absent.json();
    assert.deepEqual(body, { db: false, select1: false });
    assert.equal(JSON.stringify(body).includes(token), false);
  });

  it("does not mention the secrets in client code", () => {
    const root = join(import.meta.dirname, "..");
    const files = walk(join(root, "app")).filter((file) => !file.includes(`${join("app", "api", "report")}`));
    files.push(join(root, "lib", "report-context.ts"));
    for (const file of files) {
      if (file.includes(`${join("app", "api", "dbcheck")}`)) continue;
      const text = readFileSync(file, "utf8");
      assert.equal(text.includes("ISSUE_REPORT_TO"), false, file);
      assert.equal(text.includes("RESEND"), false, file);
      assert.equal(text.includes("api.resend.com"), false, file);
      assert.equal(text.includes("AKISMET_API_KEY"), false, file);
      assert.equal(text.includes("REPORT_FORM_SECRET"), false, file);
      assert.equal(text.includes("DBCHECK_TOKEN"), false, file);
    }
  });
});

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (/\.(tsx?|css)$/.test(name)) found.push(path);
  }
  return found;
}
