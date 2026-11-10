# Feed Tools

A small desk for podcast RSS. Paste a Pocket Casts, Apple Podcasts, or Spotify link and get the show's public feed. A second page checks a feed for the problems that stop it updating.

## Local setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The validator is at `/validator`.

```bash
npm test
npm run lint
```

Tests cover link detection, directory matching, and the address checks. They do not call Apple, Spotify, or Pocket Casts.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | Name in the header, titles, and the User-Agent. Defaults to `Feed Tools`. |
| `NEXT_PUBLIC_SITE_URL` | Public origin, with no path. Used for metadata, `robots.txt`, the sitemap, and the User-Agent. Defaults to `http://localhost:3000`. Set this in production. |

## How a link becomes a feed

- **Pocket Casts.** `pca.st` redirects to a show id. The catalog's `url` is the RSS feed for some shows and the website for others, so it is kept only when the response is RSS. Otherwise the title and author are matched to Apple Podcasts. A private show is refused.
- **Apple Podcasts.** The `id` in a show or episode link is the show. `https://itunes.apple.com/lookup?id=` returns `feedUrl`. No title guessing.
- **Spotify.** Spotify does not publish RSS. A show page's `og:title` (or, for an episode, the embed's show name) is matched to the Apple Podcasts search API. One exact title is accepted. Several matches are listed and refused. No match is reported as unresolved, which is what happens for Spotify-only shows.

Title matching uses the US Apple Podcasts directory and does not require an API key. The first search result is never used on its own.

The validator fetches a public `http` or `https` feed. Loopback, link-local, private, and non-canonical addresses are refused, including after redirects. Responses are size-capped.

## Deploying on Spacefast

This app is hosted on Spacefast. It is a Next.js server app: `/api/resolve` and `/api/validate` have to run on a server, so it should not be published as a static export.

Spacefast's CLI documents automatic builds for stable Next.js 16.2 and 16.3. This repo stays on the 16.2 line for that reason. From the project root, `sf publish` or `npx spacefast publish` is the documented way to have Spacefast detect the Next.js app, build it, and publish the server bundle (OpenNext, for apps that are not a static export). `.spacefast/` and `.open-next/` are local state and build output. Both are gitignored.

Set `NEXT_PUBLIC_SITE_URL` to the public `https` origin before building. Titles, the sitemap, `robots.txt`, and the User-Agent sent to other sites all use it.

This repository has no committed Spacefast config and does not name a team or space. Attach those in the Spacefast dashboard, or with `sf`, if they are not already linked. The commands above are taken from Spacefast's public CLI documentation. This checkout was not published from here, so confirm the current command if a publish behaves differently. There is no Vercel project config. A `.vercel` entry remains in `.gitignore` only so an old local folder is not committed.
