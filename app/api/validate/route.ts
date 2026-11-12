import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore, readSubmittedFeed } from "@/lib/api";
import { ValidateError, validateFeed } from "@/lib/validate";

// Private feeds are welcome: the URL and any login are used for this one
// fetch and never logged, stored, or echoed back.
export async function POST(req: NextRequest) {
  const feed = await readSubmittedFeed(req);
  if (feed instanceof NextResponse) return feed;
  try {
    const report = await validateFeed(feed.url, undefined, {
      username: feed.username,
      password: feed.password,
    });
    return jsonNoStore(report);
  } catch (err) {
    if (err instanceof ValidateError) {
      return jsonNoStore({ error: err.message, ...(err.needsLogin ? { needsLogin: true } : {}) }, 422);
    }
    return jsonNoStore({ error: "Something went wrong validating that feed." }, 500);
  }
}
