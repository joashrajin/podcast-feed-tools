// The Spacefast Functions database is a D1-shaped binding named DB that
// reaches MySQL. Spacefast builds a Next.js app with its own pinned OpenNext,
// whose worker puts the request's Cloudflare context (env, ctx, cf) on
// globalThis under this symbol. That is all getCloudflareContext() from
// @opennextjs/cloudflare reads, so it is read here directly rather than
// installing the adapter and its ~300 build-time packages. There is no
// connection string. Tests pass a database in and never call this.

export type ReportStatement = {
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
};

export type ReportDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): ReportStatement;
  };
};

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

type CloudflareContextLike = {
  env?: { DB?: ReportDatabase };
};

export function readSpacefastDatabase(): ReportDatabase | undefined {
  const context = (globalThis as Record<symbol, CloudflareContextLike | undefined>)[CLOUDFLARE_CONTEXT];
  const db = context?.env?.DB;
  if (!db || typeof db.prepare !== "function") return undefined;
  return db;
}

export type DbCheck = { db: boolean; select1: boolean };

/** Whether the binding is present and `select 1` returns a row. No error text. */
export async function probeDatabase(db: ReportDatabase | undefined): Promise<DbCheck> {
  if (!db) return { db: false, select1: false };
  try {
    const row = await db.prepare("select 1 as ok").bind().first<{ ok?: unknown }>();
    const ok = row?.ok;
    return { db: true, select1: ok === 1 || ok === "1" };
  } catch {
    return { db: true, select1: false };
  }
}
