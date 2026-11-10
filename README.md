# Feed Tools

Three small tools for podcast RSS.

- **Search** (`/`) looks up a show in the Pocket Casts directory and links only to that show's Pocket Casts page.
- **Locator** (`/locate`) turns a Pocket Casts, Apple Podcasts, or Spotify link into the public RSS feed.
- **Feed tools** (`/tools`) reads a public feed: show, files, cadence, and the tags that usually break an update. `/validator` redirects here.

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

Tests cover link detection, directory matching, Pocket Casts search mapping, feed checks, and the address guards. They do not call Apple, Spotify, or Pocket Casts, except one fetch of `https://example.com` is not in the suite. A live Spacefast Functions isolate was not started from this checkout.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | Name in the header, titles, and the User-Agent. Defaults to `Feed Tools`. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, with no path. Used for metadata, `robots.txt`, the sitemap, and the User-Agent. Defaults to `http://localhost:3000`. Set this in production. |

## Search

Search posts `{ "term" }` to `https://podcast-api.pocketcasts.com/v2/search/combined`, the same call the Pocket Casts website uses. Only `type: "podcast"` rows are shown. A row with a slug links to `https://pocketcasts.com/podcast/{slug}/{uuid}`; otherwise `https://pocketcasts.com/podcasts/{uuid}`.

If the directory returns no show, the page says so and links to [https://pocketcasts.com/submit/](https://pocketcasts.com/submit/). That is the form named in Pocket Casts' current support articles "Submitting Podcasts" and "Linking to my show". A request from this environment is stopped by their bot check, so the form HTML was not retrieved here. The URL is the one those articles publish.

## How a link becomes a feed

- **Pocket Casts.** `pca.st` redirects to a show id. The catalog's `url` is the RSS feed for some shows and the website for others, so it is kept only when the start of the response is an RSS channel or an Atom feed. Otherwise the title and author are matched to Apple Podcasts. A conflicting publisher is not accepted. A private show is refused.
- **Apple Podcasts.** The `id` in a show or episode link is the show. `https://itunes.apple.com/lookup?id=` returns `feedUrl`.
- **Spotify.** Spotify does not publish RSS. A show page's `og:title` (or, for an episode, the embed's show name) is matched to the Apple Podcasts search API. One exact title is accepted. Several matches, or a conflicting publisher, are refused. No match is reported as unresolved, which is what happens for Spotify-only shows.

Title matching uses the US Apple Podcasts directory and does not require an API key. The first search result is never used on its own.

## Fetching

Server-side fetches use the standard `fetch()` API, which is what [Spacefast Functions](https://spacefast.com/docs/functions/) documents for outbound HTTP. They do not use `node:dns` or `node:http`. Literal private, loopback, and link-local addresses are refused before the request, including on each redirect. Decoded bodies are capped while they are read, including gzip and brotli inflation. The rate limit uses `CF-Connecting-IP` when that header is present and ignores `X-Forwarded-For`.

On a claimed Spacefast space, worker `fetch()` can reach any public HTTP(S) host. An unclaimed space can only reach a short trusted list, which does not include Apple, Spotify, or Pocket Casts, so this app needs a claimed space. `sf dev` does not run Functions. This checkout was not published, so the worker path was not executed on Spacefast. The same `fetch()` path is what `npm test` and `npm start` exercise.

## Deploying on Spacefast

This app is hosted on Spacefast. It is a Next.js server app: the `/api/search`, `/api/resolve`, and `/api/validate` routes have to run on a server, so it should not be published as a static export.

Spacefast's CLI documents automatic builds for stable Next.js 16.2 and 16.3. This repo stays on 16.2.12, the newest 16.2 release, for that reason. From the project root, `sf publish` or `npx spacefast publish` is the documented way to have Spacefast detect the app and build it (OpenNext for a server build). `.spacefast/` and `.open-next/` are gitignored.

Set `NEXT_PUBLIC_SITE_URL` to the public `https` origin before building.

This repository has no committed Spacefast config and does not name a team or space. There is no Vercel project config. A `.vercel` entry remains in `.gitignore` only so an old local folder is not committed.

### Next.js security releases

16.2.12 includes the July 2026 fixes (published as 16.2.11). Those covered a Server Actions DoS, a Turbopack single-locale middleware bypass, rewrite and Server Action SSRF, and image-optimization issues. This app has no Server Actions, no middleware, and no `rewrites()` built from request input. Image optimization is turned off (`images.unoptimized`).

The 14 October 2026 and 3 November 2026 fixes shipped on 16.4.1 and 16.4.5 (latest 16.4 at the time of this note is 16.4.6). They cover Cache Components (`use cache`), `unstable_cache` combined with cache components, and image optimization on glibc. This app does not enable Cache Components and does not call `use cache` or `unstable_cache`. Spacefast's published automatic-build range is 16.2 and 16.3, so the app was not moved to 16.4. The image-optimization route is unused because optimization is off.
