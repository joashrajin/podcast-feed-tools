"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_MARK, SITE_TAGLINE } from "@/lib/site";

const links = [
  { href: "/", label: "Search" },
  { href: "/locate", label: "Find a feed" },
  { href: "/tools", label: "Check a feed" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="mast">
      <div className="shell mast-row">
        <Link href="/" className="brand">
          <span className="mark">{SITE_MARK}</span>
          {SITE_TAGLINE && <span className="kicker">{SITE_TAGLINE}</span>}
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
