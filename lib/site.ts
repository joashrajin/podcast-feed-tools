// Single source of truth for branding — the tool's name/domain aren't final.
// Override via env when the real name lands: NEXT_PUBLIC_SITE_NAME / NEXT_PUBLIC_SITE_URL.
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Feed Tools";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
export const USER_AGENT = `${SITE_NAME.replace(/\s+/g, "")}/1.0 (+${SITE_URL})`;
