// The address the visitor was working with, kept in this browser so the
// report form can fill it in. It is not sent anywhere until they submit.

const KEY = "feed-tools-report-url";

export function rememberReportUrl(url: string): void {
  try {
    const trimmed = url.trim().slice(0, 2000);
    if (!trimmed) return;
    sessionStorage.setItem(KEY, trimmed);
  } catch {
    // Private mode, or storage blocked. The form still works.
  }
}

export function rememberedReportUrl(): string {
  try {
    return sessionStorage.getItem(KEY)?.slice(0, 2000) ?? "";
  } catch {
    return "";
  }
}
