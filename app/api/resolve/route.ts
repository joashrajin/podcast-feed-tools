import { NextRequest } from "next/server";
import { jsonNoStore, readSubmittedUrl } from "@/lib/api";
import { identifyShow, ResolveError } from "@/lib/resolve";

// Returns either the feed ({ feedUrl, … }) or the show to match by name
// ({ search: { title, author, platform, artwork } }). The browser runs that
// Apple search itself: Apple rate-limits the shared address this host's
// servers leave from, and answers the visitor's own address normally.
export async function POST(req: NextRequest) {
  const url = await readSubmittedUrl(req);
  if (typeof url !== "string") return url;
  try {
    const identified = await identifyShow(url);
    return jsonNoStore("result" in identified ? identified.result : { search: identified.search });
  } catch (err) {
    if (err instanceof ResolveError) return jsonNoStore({ error: err.message }, 422);
    return jsonNoStore({ error: "Something went wrong resolving that link." }, 500);
  }
}
