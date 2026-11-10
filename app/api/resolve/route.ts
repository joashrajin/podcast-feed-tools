import { NextRequest } from "next/server";
import { jsonNoStore, readSubmittedUrl } from "@/lib/api";
import { ResolveError, resolveShowUrl } from "@/lib/resolve";

export async function POST(req: NextRequest) {
  const url = await readSubmittedUrl(req);
  if (typeof url !== "string") return url;
  try {
    const result = await resolveShowUrl(url);
    return jsonNoStore(result);
  } catch (err) {
    if (err instanceof ResolveError) return jsonNoStore({ error: err.message }, 422);
    return jsonNoStore({ error: "Something went wrong resolving that link." }, 500);
  }
}
