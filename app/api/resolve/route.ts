import { NextRequest, NextResponse } from "next/server";
import { resolvePocketCastsUrl, ResolveError } from "@/lib/resolve";

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({}));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  try {
    const result = await resolvePocketCastsUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ResolveError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Something went wrong resolving that link." },
      { status: 500 }
    );
  }
}
