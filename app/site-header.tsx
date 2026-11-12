"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_MARK, SITE_TAGLINE } from "@/lib/site";

const links = [
  { href: "/", label: "Find a feed" },
  { href: "/search", label: "Search" },
  { href: "/tools", label: "Check a feed" },
];

// The favicon's red feed tile, drawn inline so it costs no request. Same
// geometry as app/icon.svg, which scripts/brand-images.py writes: change both.
function BrandIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#f43e37" />
      <g fill="none" stroke="#fff" strokeWidth="6.5">
        <path d="M14 29.2A20.8 20.8 0 0 1 34.8 50" />
        <path d="M14 17.2A32.8 32.8 0 0 1 46.8 50" />
      </g>
      <circle cx="19" cy="45" r="5" fill="#fff" />
    </svg>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="mast">
      <div className="shell mast-row">
        <Link href="/" className="brand">
          <BrandIcon />
          <span className="brand-text">
            <span className="mark">{SITE_MARK}</span>
            {SITE_TAGLINE && <span className="kicker">{SITE_TAGLINE}</span>}
          </span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {links.map((link) => {
            const current = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
