"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/site";

const THEME_KEY = "feed-tools-theme";

export default function SiteHeader() {
  const pathname = usePathname();

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
    <header className="mast">
      <div className="shell mast-top">
        <div>
          <Link href="/" className="mark">
            {SITE_NAME}
          </Link>
          <p className="kicker">RSS desk</p>
        </div>
        <nav className="nav" aria-label="Primary">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
            Finder
          </Link>
          <Link href="/validator" aria-current={pathname.startsWith("/validator") ? "page" : undefined}>
            Validator
          </Link>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            <span className="when-light">Dark</span>
            <span className="when-dark">Light</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
