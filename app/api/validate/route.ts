import { NextRequest, NextResponse } from "next/server";
import { validateFeed, ValidateError } from "@/lib/validate";

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({}));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  try {
    const report = await validateFeed(url);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ValidateError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Something went wrong validating that feed." },
      { status: 500 }
    );
  }
}
