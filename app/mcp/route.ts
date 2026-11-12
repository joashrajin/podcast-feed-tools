import { NextRequest, NextResponse } from "next/server";
import { clientKey, readLimitedBytes } from "@/lib/api";
import { handleBody, parseError, PROTOCOL_VERSIONS, errorResult } from "@/lib/mcp/server";
import { INSTRUCTIONS, tools } from "@/lib/mcp/tools";
import { rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Claude's connectors call from shared addresses, so tool calls get more
// room than the website's forms. Listing tools and initializing aren't counted.
const TOOL_CALLS_PER_MINUTE = 60;
const MAX_BODY = 65_536;

// No cookies or credentials are involved, so any origin may call it. That is
// also why the Origin check the spec asks of local servers isn't needed here.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

const HEADERS = { ...CORS, "cache-control": "no-store" };

const TOOLS = tools();

export async function POST(req: NextRequest) {
  const version = req.headers.get("mcp-protocol-version");
  if (version && !(PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${version}` } },
      { status: 400, headers: HEADERS }
    );
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return new NextResponse(null, { status: 413, headers: HEADERS });
  }
  const bytes = await readLimitedBytes(req.body, MAX_BODY);
  if (bytes === "too-large") return new NextResponse(null, { status: 413, headers: HEADERS });

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json(parseError(), { status: 400, headers: HEADERS });
  }

  const key = `mcp:${clientKey(req)}`;
  const { status, json } = await handleBody(body, {
    info: { name: "podcast-tools", title: SITE_NAME, version: "1.0.0", instructions: INSTRUCTIONS },
    tools: TOOLS,
    beforeToolCall: () =>
      rateLimit(key, TOOL_CALLS_PER_MINUTE)
        ? undefined
        : errorResult(`Too many tool calls from this address. Try again in ${retryAfterSeconds(key)} seconds.`),
  });
  if (json === undefined) return new NextResponse(null, { status, headers: HEADERS });
  return NextResponse.json(json, { status, headers: HEADERS });
}

/** No server-initiated stream is offered, which the spec answers with 405. */
export function GET() {
  return NextResponse.json(
    {
      error: `This is the ${SITE_NAME} MCP endpoint. Add it to Claude or another MCP client as a remote server: ${SITE_URL}/mcp. Setup: ${SITE_URL}/connect`,
    },
    { status: 405, headers: { ...HEADERS, allow: "POST, OPTIONS" } }
  );
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, allow: "POST, OPTIONS" } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
