# Podcast: Search and Tools

Three small tools for podcast RSS.

- **Locator** (`/`, the homepage) turns a Pocket Casts, Apple Podcasts, or Spotify link into the public RSS feed. `/locate` redirects here.
- **Search** (`/search`) looks up a show in the Pocket Casts directory and links only to that show's Pocket Casts page.
- **Feed tools** (`/tools`) reads a feed, public or private: show, files, cadence, and the tags that usually break an update. `/validator` redirects here.
- **MCP server** (`/mcp`) gives Claude and other MCP clients the same lookups as tools, for support and debugging. Setup is at `/connect`.

## Local setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run lint
npm run build
```

Tests cover link detection, directory matching, Pocket Casts search mapping, feed checks, issue reports, and the address guards. They do not call Apple, Spotify, Pocket Casts, or Akismet, except one fetch of `https://example.com` is not in the suite. A live Spacefast Functions isolate was not started from this checkout.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | Name in the header, titles, and the User-Agent. Defaults to `Podcast: Search and Tools`. A name with `: ` shows the part before it as the header mark and the rest beneath it. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, with no path. Used for metadata, `robots.txt`, the sitemap, and the User-Agent. Defaults to `https://podcast.space.fast` in production builds and `http://localhost:3000` otherwise. |
| `REPORT_FORM_SECRET` | Signs the report form's timestamp. Server only. See [Issue reports](#issue-reports). |
| `AKISMET_API_KEY` | Akismet key for the report form. Optional. Server only. |
| `SITE_URL` | Absolute site URL sent to Akismet as `blog`. Optional. Falls back to `NEXT_PUBLIC_SITE_URL`. |
| `DBCHECK_TOKEN` | Gates `GET /api/dbcheck`. Optional. Server only. |

### Icons and share images

`npm run images` draws the favicon, the Apple and home-screen icons, and each page's share image (`opengraph-image.png`). The share images include the site name, address, and page headline, so run it again after changing any of them. It needs a prior `npm run build` (for the Inter font files), Python with Pillow, fontTools and brotli, and Google Chrome.

## MCP server

`POST /mcp` is a stateless, read-only MCP server over Streamable HTTP. It returns JSON and has no sessions, server-sent events, or sign-in. Add it to Claude as a custom connector, or in Claude Code:

```bash
claude mcp add --transport http podcast-tools https://podcast.space.fast/mcp
```

| Tool | What it returns |
| --- | --- |
| `search_pocket_casts` | Shows matching a name, with UUIDs and Pocket Casts links |
| `get_pocket_casts_show` | Pocket Casts' catalog entry: episode count, frequency, newest and next expected episode, recent episodes |
| `find_feed_url` | The RSS feed behind a Pocket Casts, Apple Podcasts, or Spotify link |
| `check_feed` | The feed checker's summary and problems, for public or private feeds |
| `list_feed_episodes` | Episodes as the feed states them, newest first, with GUIDs and files, duplicate GUIDs flagged |
| `compare_feed_with_pocket_casts` | Feed against catalog: counts, newest on each side, episodes missing from either |

Protocol code is in `lib/mcp/server.ts` and the tools are in `lib/mcp/tools.ts`. Tool calls are limited to 60 a minute per address. `/connect` lists the tools from the same definitions.

## Search

Search posts `{ "term" }` to `https://podcast-api.pocketcasts.com/v2/search/combined`, the same call the Pocket Casts website uses. Only `type: "podcast"` rows are shown. A row with a slug links to `https://pocketcasts.com/podcast/{slug}/{uuid}`; otherwise `https://pocketcasts.com/podcasts/{uuid}`.

If the directory returns no show, the page says so and links to [https://pocketcasts.com/submit/](https://pocketcasts.com/submit/). That is the form named in Pocket Casts' current support articles "Submitting Podcasts" and "Linking to my show". A request from this environment is stopped by their bot check, so the form HTML was not retrieved here. The URL is the one those articles publish.

## How a link becomes a feed

- **Pocket Casts.** `pca.st` redirects to a show id. The catalog's `url` is the RSS feed for some shows and the website for others, so it is kept only when the start of the response is an RSS channel or an Atom feed. Otherwise the title and author are matched to Apple Podcasts. A conflicting publisher is not accepted. A private show is refused.
- **Apple Podcasts.** The `id` in a show or episode link is the show. The page requests `https://itunes.apple.com/lookup?id=` in the browser, which Apple allows cross-origin, and posts `feedUrl`, title, author, and artwork back. The server accepts that claim only after the same public-URL check it uses when it fetched the lookup itself, and refuses a claim that names a different show. If the browser gets no readable answer, the server does the lookup and retries once on a non-2xx status or a body that isn't JSON. Both attempts share one 8 second deadline, with a short pause before the second. A failure then asks the visitor to try again.
- **Spotify.** Spotify does not publish RSS. A show page's `og:title` (or, for an episode, the embed's show name) is matched to the Apple Podcasts search API. One exact title is accepted. Several matches, or a conflicting publisher, are refused. No match is reported as unresolved, which is what happens for Spotify-only shows.

Title matching uses the US Apple Podcasts directory and does not require an API key. The first search result is never used on its own. On the website the browser runs that search, as it does the Apple lookup, because Apple often refuses this host's address. Pocket Casts and Spotify already took that path, so their name match does not depend on the host. Server-side callers, including the MCP tools and `resolveShowUrl`, search from the server and use the same one-retry deadline when Apple's answer can't be read.

## Fetching

Server-side fetches on Node open the socket with `http.request` / `https.request` and a connect-time DNS lookup. That lookup is the only resolution: a DNS error fails closed, a private answer fails closed, and the connection uses those addresses. Literal private addresses are refused before that, including on every redirect. Decoded bodies are capped while they are read. Gzip, brotli, and deflate are inflated only when the raw response's `Content-Encoding` says so. A truncated compressed body, or a disconnect while that body is still arriving, closes the socket and the decoder and returns a fetch error.

Spacefast Functions do not honor a custom lookup. Their [outbound `fetch()`](https://spacefast.com/docs/functions/) is limited to public HTTP(S) hosts on a claimed space, and the worker refuses private networks. This app uses that `fetch()` only when the isolate is a Cloudflare worker (`Cloudflare-Workers` or `WebSocketPair`). On that path, rebinding protection is the platform's. Any other runtime that cannot pin a connection refuses the request. An unclaimed space can only reach a short trusted list, which does not include Apple, Spotify, or Pocket Casts, so this app needs a claimed space. `sf dev` does not run Functions, and this checkout was not published, so the worker path was not executed on Spacefast.

The rate limit uses `CF-Connecting-IP` when that header is present and ignores `X-Forwarded-For`.

## Issue reports

The footer link **Report an issue** opens a short form. `POST /api/report` stores the note in the Spacefast database. Nothing about it is listed by a public URL.

Spacefast gives every Functions worker a database and no connection string. Spacefast builds this app with its own pinned OpenNext, whose worker puts the request's Cloudflare context on `globalThis` under `Symbol.for("__cloudflare-context__")`. `lib/spacefast-db.ts` reads `env.DB` from there, which is what OpenNext's `getCloudflareContext()` does, so `@opennextjs/cloudflare` is not a dependency. `env.DB` is D1-shaped (`prepare`, `bind`, `run`) and its statements reach MySQL unchanged. The table is `issue_reports`. The first write runs `CREATE TABLE IF NOT EXISTS`. The same statement is below if you would rather run it yourself.

```sql
CREATE TABLE IF NOT EXISTS issue_reports (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at VARCHAR(40) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  page VARCHAR(500) NULL,
  url VARCHAR(2000) NULL,
  email VARCHAR(254) NULL,
  user_agent VARCHAR(300) NULL,
  spam_verdict VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL
);
```

`REPORT_FORM_SECRET` is required. It signs the time the form was rendered, so a posted token cannot be forged or reused after 12 hours, and a post in the first few seconds is refused. `AKISMET_API_KEY` is optional. When it is set, the server posts the note to `https://rest.akismet.com/1.1/comment-check`. A discard tip is dropped. Other spam is stored with `status` `spam`. If Akismet is down or the key is unset, the note is stored with verdict `unchecked`. The visitor always sees "Thanks, we got it." `SITE_URL` is the `blog` value Akismet requires. When it is unset, the public site origin is used.

On Spacefast, set the secrets from the project root. Each command reads the value from stdin:

```bash
sf env set REPORT_FORM_SECRET --value-from-stdin
sf env set AKISMET_API_KEY --value-from-stdin
sf env set SITE_URL --value-from-stdin
```

The space has to be claimed. An unclaimed space cannot reach `rest.akismet.com`.

`GET /api/dbcheck` with header `x-dbcheck-token` set to `DBCHECK_TOKEN` answers `{ "db": true, "select1": true }` when `env.DB` can run `select 1`. Any other caller gets a 404. The body never includes a row, a secret, or an error string.

### Reading reports

There is no public list. Functions workers do not declare tables, and the Spacefast docs say `sf db`, `sf db dump`, `sf db migrate`, and `sf db export` are for Zero capsules, so they answer `runtime_kind_mismatch` or `db_not_available` for this app. The documented way to read a Functions database is the SQL console:

```bash
sf db console
```

Or open Database for the space in the dashboard and choose Open db console. Then:

```sql
SELECT id, created_at, status, spam_verdict, page, url, email, message
FROM issue_reports
ORDER BY id DESC;
```

Docs: [Functions](https://spacefast.com/docs/functions/), [Database](https://spacefast.com/docs/database/), [sf db](https://spacefast.com/docs/cli/db), [OpenNext bindings](https://opennext.js.org/cloudflare/bindings).

## Deploying on Spacefast

This app is hosted on Spacefast. It is a Next.js server app: the `/api/search`, `/api/resolve`, `/api/validate`, and `/api/report` routes have to run on a server, so it should not be published as a static export.

Spacefast's CLI documents automatic builds for stable Next.js 16.2 and 16.3. This repo is on 16.3.8. From the project root, `sf publish` or `npx spacefast publish` is the documented way to have Spacefast detect the app and build it (OpenNext for a server build). `.spacefast/` and `.open-next/` are gitignored.

Set `NEXT_PUBLIC_SITE_URL` to the public `https` origin before building.

This repository has no committed Spacefast config and does not name a team or space. There is no Vercel project config. A `.vercel` entry remains in `.gitignore` only so an old local folder is not committed.

### Next.js security releases

The app is on 16.3.8, the September 2026 patched 16.3 release, which Spacefast's automatic builds cover. That release includes the [September 2026 fixes](https://nextjs.org/blog/september-2026-security-release). The development-server MCP endpoint no longer accepts a cross-site read of project data (`CVE-2026-94486`). It only ever existed on `next dev`; production does not serve it. The same release covers image-optimization SSRF when `images.remotePatterns` is set (this app sets none, and `images.unoptimized` is on), Pages Router cache poisoning (this app is App Router only), metadata-image `dynamicParams` bypass under webpack, and Cache Components leaks. This app does not enable Cache Components and does not use `use cache` or Draft Mode.

16.3.8 also includes the July 2026 fixes that were on the 16.2 line (Server Actions DoS, Turbopack single-locale middleware bypass, rewrite SSRF). This app has no Server Actions, no middleware, and no request-built rewrites.

The 14 October 2026 and 3 November 2026 fixes shipped on 16.4.1 and 16.4.5. They cover Cache Components and image optimization on glibc. Those features are off here. 16.4 is outside the 16.2/16.3 range Spacefast documents for automatic builds, so the app stays on 16.3.8.
