"use client";

// Matches the key read by the boot script in app/layout.tsx.
const THEME_KEY = "feed-tools-theme";

// The page's theme is set before paint by the script in the layout, so the
// server can't know it. CSS shows the matching icon and label instead of
// React state, which keeps the server and client markup identical.
export default function ThemeToggle() {
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Storage can be blocked. The choice still applies for this view. */
    }
  }

  return (
    <button type="button" className="theme-fab" onClick={toggleTheme}>
      <span className="when-light">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">Switch to dark mode</span>
      </span>
      <span className="when-dark">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="sr-only">Switch to light mode</span>
      </span>
    </button>
  );
}
