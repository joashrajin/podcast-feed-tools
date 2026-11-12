import { NextResponse } from "next/server";
import { probeDatabase, readSpacefastDatabase, type ReportDatabase } from "./spacefast-db";

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
}

// Token-gated check that the Functions database binding answers `select 1`.
// The body is only `{ db, select1 }`. Unset or wrong token is a 404.
export async function handleDbCheck(
  req: { headers: { get(name: string): string | null } },
  deps: { token?: string; db?: ReportDatabase | null } = {}
) {
  const expected = "token" in deps ? deps.token?.trim() : process.env.DBCHECK_TOKEN?.trim();
  const given = req.headers.get("x-dbcheck-token")?.trim() ?? "";
  if (!expected || expected.length < 16 || !sameText(given, expected)) return notFound();
  const db = "db" in deps ? deps.db ?? undefined : readSpacefastDatabase();
  const probe = await probeDatabase(db);
  return NextResponse.json(probe, { headers: { "cache-control": "no-store" } });
}
