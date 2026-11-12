/**
 * A stateless Model Context Protocol server: tools only, over Streamable HTTP,
 * with JSON responses. No sessions and no server-sent events, so every POST
 * stands alone and any instance can answer it.
 *
 * https://modelcontextprotocol.io/specification
 */

/** Newest first. The first is offered to a client asking for a version not listed. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export type ServerInfo = {
  name: string;
  title: string;
  version: string;
  instructions?: string;
};

export type Context = {
  info: ServerInfo;
  tools: Tool[];
  /** Runs before each tool call. A result returned here is sent instead, as with a rate limit. */
  beforeToolCall?: (name: string) => ToolResult | undefined;
};

type Id = string | number;
type Response =
  | { jsonrpc: "2.0"; id: Id | null; result: unknown }
  | { jsonrpc: "2.0"; id: Id | null; error: { code: number; message: string; data?: unknown } };

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

const fail = (id: Id | null, code: number, message: string): Response => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** The value as JSON text, and as structured content with undefined fields already dropped. */
export function textResult(value: unknown): ToolResult {
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  const text = JSON.stringify(value);
  const structured = value && typeof value === "object" && !Array.isArray(value);
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: JSON.parse(text) as Record<string, unknown> } : {}),
  };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function negotiate(requested: unknown): string {
  return typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : PROTOCOL_VERSIONS[0];
}

function isId(value: unknown): value is Id {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** One JSON-RPC message in, one response out, or undefined for a notification or a client's response. */
export async function handleMessage(message: unknown, context: Context): Promise<Response | undefined> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return fail(null, INVALID_REQUEST, "Expected a JSON-RPC 2.0 object.");
  }
  const { jsonrpc, id, method, params } = message as Record<string, unknown>;
  const replyId = isId(id) ? id : null;
  if (jsonrpc !== "2.0") return fail(replyId, INVALID_REQUEST, 'jsonrpc must be "2.0".');

  if (typeof method !== "string") {
    // A response from the client. This server never sends requests, so there is nothing to match.
    if ("result" in (message as object) || "error" in (message as object)) return undefined;
    return fail(replyId, INVALID_REQUEST, "Missing method.");
  }
  if (id === undefined) return undefined; // A notification, such as notifications/initialized.
  if (!isId(id)) return fail(null, INVALID_REQUEST, "id must be a string or a number.");

  const args = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiate(args.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: context.info.name, title: context.info.title, version: context.info.version },
          ...(context.info.instructions ? { instructions: context.info.instructions } : {}),
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: context.tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
              title: tool.title,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          })),
        },
      };
    case "tools/call": {
      const name = args.name;
      const tool = typeof name === "string" ? context.tools.find((candidate) => candidate.name === name) : undefined;
      if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${typeof name === "string" ? name : "(none)"}`);
      const input = args.arguments;
      if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
        return fail(id, INVALID_PARAMS, "arguments must be an object.");
      }
      const blocked = context.beforeToolCall?.(tool.name);
      if (blocked) return { jsonrpc: "2.0", id, result: blocked };
      try {
        return { jsonrpc: "2.0", id, result: await tool.run((input as Record<string, unknown>) ?? {}) };
      } catch (err) {
        console.error(`[mcp] ${tool.name} failed`, err);
        return { jsonrpc: "2.0", id, result: errorResult("Something went wrong running that tool. Try again.") };
      }
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * A parsed POST body in, the HTTP status and JSON body out. A batch (allowed
 * in the 2025-03-26 revision) gets an array back. Notifications alone get 202.
 */
export async function handleBody(body: unknown, context: Context): Promise<{ status: number; json?: unknown }> {
  if (Array.isArray(body)) {
    if (body.length === 0) return { status: 400, json: fail(null, INVALID_REQUEST, "Empty batch.") };
    if (body.length > 20) return { status: 400, json: fail(null, INVALID_REQUEST, "Batches are limited to 20 messages.") };
    const replies = (await Promise.all(body.map((item) => handleMessage(item, context)))).filter(
      (reply): reply is Response => reply !== undefined
    );
    return replies.length ? { status: 200, json: replies } : { status: 202 };
  }
  const reply = await handleMessage(body, context);
  return reply ? { status: 200, json: reply } : { status: 202 };
}

export const parseError = () => fail(null, PARSE_ERROR, "Body isn't valid JSON.");
