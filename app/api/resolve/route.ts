import { NextRequest } from "next/server";
import { jsonNoStore, readSubmittedResolve } from "@/lib/api";
import { acceptAppleLookup, candidateHits, identifyShow, resolveAmongCandidates, ResolveError } from "@/lib/resolve";

// Returns the feed, or { search } when the show is known by name and the
// browser should match it in Apple Podcasts. An Apple Podcasts link may
// include `apple`, the lookup the browser already did. That claim is checked
// here and Apple is not asked again. Without it, this server asks Apple and
// retries once when the answer can't be read. Apple rate-limits the shared
// address these servers leave from, and answers the visitor's own normally.
//
// `candidates` is the browser's Apple search when several same-named shows
// fit a Pocket Casts link. The show is identified here again, and only a
// candidate with its title whose feed has Pocket Casts' newest episode wins.
export async function POST(req: NextRequest) {
  const submitted = await readSubmittedResolve(req);
  if (submitted instanceof Response) return submitted;
  try {
    if (submitted.apple !== undefined) {
      return jsonNoStore(acceptAppleLookup(submitted.url, submitted.apple));
    }
    const identified = await identifyShow(submitted.url);
    if (submitted.candidates && "search" in identified) {
      const picked = await resolveAmongCandidates(identified.search, candidateHits(submitted.candidates), "itunes-search");
      if (picked) return jsonNoStore(picked);
      return jsonNoStore({ error: "None of those feeds has Pocket Casts' newest episode, so the show couldn't be picked out." }, 422);
    }
    return jsonNoStore("result" in identified ? identified.result : { search: identified.search });
  } catch (err) {
    if (err instanceof ResolveError) return jsonNoStore({ error: err.message }, 422);
    return jsonNoStore({ error: "Something went wrong resolving that link." }, 500);
  }
}
