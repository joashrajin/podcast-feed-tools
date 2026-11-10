import { NextRequest } from "next/server";
import { jsonNoStore, readJsonObject } from "@/lib/api";
import { POCKET_CASTS_SUBMIT_URL, podcastHitsFromSearch } from "@/lib/search";
import { FetchError, safeFetch } from "@/lib/net";
import { USER_AGENT } from "@/lib/site";

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const query = body.query;
  if (typeof query !== "string" || !query.trim()) {
    return jsonNoStore({ error: "Missing query." }, 400);
  }
  const term = query.trim();
  if (term.length > 200) return jsonNoStore({ error: "That search is too long." }, 400);

  try {
    const response = await safeFetch("https://podcast-api.pocketcasts.com/v2/search/combined", {
      method: "POST",
      body: JSON.stringify({ term }),
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["podcast-api.pocketcasts.com"],
      timeoutMs: 8000,
      maxBytes: 2_000_000,
    });
    if (response.status < 200 || response.status >= 300) {
      return jsonNoStore({ error: "Pocket Casts search didn't respond. Try again in a moment." }, 502);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return jsonNoStore({ error: "Pocket Casts search returned something that couldn't be read." }, 502);
    }
    const shows = podcastHitsFromSearch(payload);
    return jsonNoStore({ query: term, shows, submitUrl: POCKET_CASTS_SUBMIT_URL });
  } catch (err) {
    if (err instanceof FetchError) {
      return jsonNoStore({ error: "Pocket Casts search didn't respond. Try again in a moment." }, 502);
    }
    return jsonNoStore({ error: "Something went wrong searching Pocket Casts." }, 500);
  }
}
