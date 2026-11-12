import { FetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";
import { podcastHitsFromSearch, type PocketCastsHit } from "./search";
import { USER_AGENT } from "./site";

export class SearchError extends Error {}

/** Search the Pocket Casts directory, as the Pocket Casts website does. */
export async function searchPocketCasts(
  term: string,
  limit = 12,
  fetchImpl: (input: string, options: SafeFetchOptions) => Promise<SafeResponse> = safeFetch
): Promise<PocketCastsHit[]> {
  let response: SafeResponse;
  try {
    response = await fetchImpl("https://podcast-api.pocketcasts.com/v2/search/combined", {
      method: "POST",
      body: JSON.stringify({ term }),
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["podcast-api.pocketcasts.com"],
      timeoutMs: 8000,
      maxBytes: 2_000_000,
    });
  } catch (err) {
    if (err instanceof FetchError) throw new SearchError("Pocket Casts search didn't respond. Try again in a moment.");
    throw err;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new SearchError("Pocket Casts search didn't respond. Try again in a moment.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new SearchError("Pocket Casts search returned something that couldn't be read.");
  }
  const shows = podcastHitsFromSearch(payload, limit);
  if (!shows) throw new SearchError("Pocket Casts search returned something that couldn't be read.");
  return shows;
}
