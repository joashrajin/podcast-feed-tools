"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_MARK, SITE_TAGLINE } from "@/lib/site";

const THEME_KEY = "feed-tools-theme";

const links = [
  { href: "/", label: "Search" },
  { href: "/locate", label: "Locator" },
  { href: "/tools", label: "Feed tools" },
];

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
            {SITE_MARK}
          </Link>
          <p className="kicker">{SITE_TAGLINE ?? "Search, locate, check"}</p>
        </div>
        <nav className="nav" aria-label="Primary">
          {links.map((link) => {
            const current = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            <span className="when-light">Dark</span>
            <span className="when-dark">Light</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
