import { NextRequest } from "next/server";
import { jsonNoStore, readSubmittedUrl } from "@/lib/api";
import { ValidateError, validateFeed } from "@/lib/validate";

export async function POST(req: NextRequest) {
  const url = await readSubmittedUrl(req);
  if (typeof url !== "string") return url;
  try {
    const report = await validateFeed(url);
    return jsonNoStore(report);
  } catch (err) {
    if (err instanceof ValidateError) return jsonNoStore({ error: err.message }, 422);
    return jsonNoStore({ error: "Something went wrong validating that feed." }, 500);
  }
}
