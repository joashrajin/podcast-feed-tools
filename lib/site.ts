// Name and origin. Set NEXT_PUBLIC_SITE_NAME and NEXT_PUBLIC_SITE_URL in production.
// The URL is used for metadata, robots, the sitemap, and the User-Agent.
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Feed Tools";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
export const USER_AGENT = `${SITE_NAME.replace(/\s+/g, "")}/1.0 (+${SITE_URL})`;
