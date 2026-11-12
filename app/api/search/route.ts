import { NextRequest } from "next/server";
import { jsonNoStore, readJsonObject } from "@/lib/api";
import { POCKET_CASTS_SUBMIT_URL } from "@/lib/search";
import { SearchError, searchPocketCasts } from "@/lib/search-server";

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
    const shows = await searchPocketCasts(term);
    return jsonNoStore({ query: term, shows, submitUrl: POCKET_CASTS_SUBMIT_URL });
  } catch (err) {
    if (err instanceof SearchError) return jsonNoStore({ error: err.message }, 502);
    return jsonNoStore({ error: "Something went wrong searching Pocket Casts." }, 500);
  }
}
