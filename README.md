# Podcast: Search and Tools

Three small tools for podcast RSS.

- **Locator** (`/`, the homepage) turns a Pocket Casts, Apple Podcasts, or Spotify link into the public RSS feed. `/locate` redirects here.
- **Search** (`/search`) looks up a show in the Pocket Casts directory and links only to that show's Pocket Casts page.
- **Feed tools** (`/tools`) reads a feed, public or private: show, files, cadence, and the tags that usually break an update. `/validator` redirects here.

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
| `NEXT_PUBLIC_SITE_NAME` | Name in the header, titles, and the User-Agent. Defaults to `Podcast: Search and Tools`. A name with `: ` shows the part before it as the header mark and the rest beneath it. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, with no path. Used for metadata, `robots.txt`, the sitemap, and the User-Agent. Defaults to `https://podcast.space.fast` in production builds and `http://localhost:3000` otherwise. |

## Search

Search posts `{ "term" }` to `https://podcast-api.pocketcasts.com/v2/search/combined`, the same call the Pocket Casts website uses. Only `type: "podcast"` rows are shown. A row with a slug links to `https://pocketcasts.com/podcast/{slug}/{uuid}`; otherwise `https://pocketcasts.com/podcasts/{uuid}`.

If the directory returns no show, the page says so and links to [https://pocketcasts.com/submit/](https://pocketcasts.com/submit/). That is the form named in Pocket Casts' current support articles "Submitting Podcasts" and "Linking to my show". A request from this environment is stopped by their bot check, so the form HTML was not retrieved here. The URL is the one those articles publish.

## How a link becomes a feed

- **Pocket Casts.** `pca.st` redirects to a show id. The catalog's `url` is the RSS feed for some shows and the website for others, so it is kept only when the start of the response is an RSS channel or an Atom feed. Otherwise the title and author are matched to Apple Podcasts. A conflicting publisher is not accepted. A private show is refused.
- **Apple Podcasts.** The `id` in a show or episode link is the show. `https://itunes.apple.com/lookup?id=` returns `feedUrl`.
- **Spotify.** Spotify does not publish RSS. A show page's `og:title` (or, for an episode, the embed's show name) is matched to the Apple Podcasts search API. One exact title is accepted. Several matches, or a conflicting publisher, are refused. No match is reported as unresolved, which is what happens for Spotify-only shows.

Title matching uses the US Apple Podcasts directory and does not require an API key. The first search result is never used on its own.

## Fetching

Server-side fetches on Node open the socket with `http.request` / `https.request` and a connect-time DNS lookup. That lookup is the only resolution: a DNS error fails closed, a private answer fails closed, and the connection uses those addresses. Literal private addresses are refused before that, including on every redirect. Decoded bodies are capped while they are read. Gzip, brotli, and deflate are inflated only when the raw response's `Content-Encoding` says so. A truncated compressed body, or a disconnect while that body is still arriving, closes the socket and the decoder and returns a fetch error.

Spacefast Functions do not honor a custom lookup. Their [outbound `fetch()`](https://spacefast.com/docs/functions/) is limited to public HTTP(S) hosts on a claimed space, and the worker refuses private networks. This app uses that `fetch()` only when the isolate is a Cloudflare worker (`Cloudflare-Workers` or `WebSocketPair`). On that path, rebinding protection is the platform's. Any other runtime that cannot pin a connection refuses the request. An unclaimed space can only reach a short trusted list, which does not include Apple, Spotify, or Pocket Casts, so this app needs a claimed space. `sf dev` does not run Functions, and this checkout was not published, so the worker path was not executed on Spacefast.

The rate limit uses `CF-Connecting-IP` when that header is present and ignores `X-Forwarded-For`.

## Deploying on Spacefast

This app is hosted on Spacefast. It is a Next.js server app: the `/api/search`, `/api/resolve`, and `/api/validate` routes have to run on a server, so it should not be published as a static export.

Spacefast's CLI documents automatic builds for stable Next.js 16.2 and 16.3. This repo is on 16.3.8. From the project root, `sf publish` or `npx spacefast publish` is the documented way to have Spacefast detect the app and build it (OpenNext for a server build). `.spacefast/` and `.open-next/` are gitignored.

Set `NEXT_PUBLIC_SITE_URL` to the public `https` origin before building.

This repository has no committed Spacefast config and does not name a team or space. There is no Vercel project config. A `.vercel` entry remains in `.gitignore` only so an old local folder is not committed.

### Next.js security releases

The app is on 16.3.8, the September 2026 patched 16.3 release, which Spacefast's automatic builds cover. That release includes the [September 2026 fixes](https://nextjs.org/blog/september-2026-security-release). The development-server MCP endpoint no longer accepts a cross-site read of project data (`CVE-2026-94486`). It only ever existed on `next dev`; production does not serve it. The same release covers image-optimization SSRF when `images.remotePatterns` is set (this app sets none, and `images.unoptimized` is on), Pages Router cache poisoning (this app is App Router only), metadata-image `dynamicParams` bypass under webpack, and Cache Components leaks. This app does not enable Cache Components and does not use `use cache` or Draft Mode.

16.3.8 also includes the July 2026 fixes that were on the 16.2 line (Server Actions DoS, Turbopack single-locale middleware bypass, rewrite SSRF). This app has no Server Actions, no middleware, and no request-built rewrites.

The 14 October 2026 and 3 November 2026 fixes shipped on 16.4.1 and 16.4.5. They cover Cache Components and image optimization on glibc. Those features are off here. 16.4 is outside the 16.2/16.3 range Spacefast documents for automatic builds, so the app stays on 16.3.8.
