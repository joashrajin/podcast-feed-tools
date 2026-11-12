#!/usr/bin/env python3
"""Draw the site icons and the share images.

    npm run build                      # provides the Inter font files
    python3 scripts/brand-images.py

Needs Pillow, fontTools and brotli, plus Google Chrome for the share images
(set CHROME to its binary elsewhere than macOS). Run it again whenever the
site name, address, or page headlines change: the images bake them in.
"""

from __future__ import annotations

import base64
import html
import os
import pathlib
import re
import subprocess
import tempfile

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "app"
PUBLIC = ROOT / "public"

BRAND = "#f43e37"
PAPER = "#f7f9fa"
INK = "#292b2e"
MUTED = "#5c6570"
ACCENT = "#cc2e28"

# The mark: a feed symbol on a red tile, drawn on a 64-unit grid.
CORNER = 14  # tile corner radius
ORIGIN = (14, 50)  # centre of both arcs
ARCS = (20.8, 32.8)  # arc radii, measured to the middle of the stroke
STROKE = 6.5
DOT = ((19, 45), 5)

# Share images, one per page. Keep the headlines in step with each page's h1.
CARDS = {
    APP: (
        "Find any RSS feed",
        "Podcasts, YouTube channels, SoundCloud creators, and blogs.",
        "Find the RSS feed behind a podcast, YouTube channel, SoundCloud profile, or website.",
    ),
    APP / "faq": (
        "How links become feeds",
        "Pocket Casts, Apple, Spotify, YouTube, SoundCloud, and websites.",
        "How podcast, YouTube, SoundCloud, and website links are turned into RSS feeds.",
    ),
    APP / "dev": (
        "Connect any AI assistant",
        "An open MCP server for finding and checking RSS feeds.",
        "Connect any AI assistant or MCP client to find and check RSS feeds.",
    ),
    APP / "tools": (
        "Check a podcast RSS feed",
        "Public or private. Find the tags and files that stop a show updating.",
        "Check a podcast RSS feed, public or private, for problems that stop it updating.",
    ),
    APP / "search": (
        "Search Pocket Casts",
        "Find a show by name and open it on Pocket Casts.",
        "Search the Pocket Casts directory and open a show on Pocket Casts.",
    ),
}


def site() -> tuple[str, str]:
    source = (ROOT / "lib" / "site.ts").read_text()
    name = os.environ.get("NEXT_PUBLIC_SITE_NAME") or re.search(
        r'NEXT_PUBLIC_SITE_NAME \?\? "([^"]+)"', source
    ).group(1)
    url = os.environ.get("NEXT_PUBLIC_SITE_URL") or re.search(
        r'\? "(https://[^"]+)"', source
    ).group(1)
    return name, url


def svg_mark() -> str:
    (ox, oy), (dx, dy), r = ORIGIN, DOT[0], DOT[1]
    arcs = "".join(
        f'<path d="M{ox} {oy - R:g}A{R:g} {R:g} 0 0 1 {ox + R:g} {oy}"/>' for R in ARCS
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<rect width="64" height="64" rx="{CORNER}" fill="{BRAND}"/>'
        f'<g fill="none" stroke="#fff" stroke-width="{STROKE}">{arcs}</g>'
        f'<circle cx="{dx}" cy="{dy}" r="{r}" fill="#fff"/>'
        "</svg>\n"
    )


def raster_mark(size: int, *, rounded: bool = True, scale: float = 1.0) -> Image.Image:
    """The mark at `size` pixels, drawn 8x larger and scaled down for clean edges."""
    big = size * 8
    unit = big / 64
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if rounded:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=CORNER * unit, fill=BRAND)
    else:
        draw.rectangle([0, 0, big, big], fill=BRAND)

    def at(x: float, y: float) -> tuple[float, float]:
        return (32 + (x - 32) * scale) * unit, (32 + (y - 32) * scale) * unit

    width = STROKE * scale * unit
    cx, cy = at(*ORIGIN)
    for radius in ARCS:
        outer = radius * scale * unit + width / 2
        draw.arc([cx - outer, cy - outer, cx + outer, cy + outer], 270, 360, fill="white", width=round(width))
    (dx, dy), r = at(*DOT[0]), DOT[1] * scale * unit
    draw.ellipse([dx - r, dy - r, dx + r, dy + r], fill="white")
    return image.resize((size, size), Image.LANCZOS)


def write_icons() -> None:
    (APP / "icon.svg").write_text(svg_mark())
    raster_mark(48).save(
        APP / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[raster_mark(16), raster_mark(32)],
    )
    # iOS rounds the corners itself and shows transparency as black.
    raster_mark(180, rounded=False).convert("RGB").save(APP / "apple-icon.png", optimize=True)
    icons = PUBLIC / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    raster_mark(192).save(icons / "icon-192.png", optimize=True)
    raster_mark(512).save(icons / "icon-512.png", optimize=True)
    # Android crops maskable icons to a circle, so the symbol sits well inside it.
    raster_mark(512, rounded=False, scale=0.8).convert("RGB").save(icons / "maskable-512.png", optimize=True)


def inter_woff2() -> pathlib.Path:
    """The Latin subset of Inter that next/font saved during the last build."""
    for path in sorted((ROOT / ".next" / "static" / "media").glob("*.woff2")):
        font = TTFont(path)
        family = font["name"].getDebugName(1) or ""
        cmap = font.getBestCmap() or {}
        if family.startswith("Inter") and ord("A") in cmap and 0x2019 in cmap:
            return path
    raise SystemExit("Inter not found in .next/static/media. Run `npm run build` first.")


def card_html(font: str, name: str, host: str, headline: str, line: str) -> str:
    colon = name.find(": ")
    mark, kicker = (name[:colon], name[colon + 2 :]) if colon > 0 else (name, "")
    logo = "data:image/svg+xml;base64," + base64.b64encode(svg_mark().encode()).decode()
    e = html.escape
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter; src: url(data:font/woff2;base64,{font}) format("woff2"); font-weight: 100 900; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; width: 1200px; height: 630px; overflow: hidden; }}
body {{ font-family: Inter; background: {PAPER}; color: {INK}; border-top: 14px solid {BRAND};
  padding: 60px 80px 56px; display: flex; flex-direction: column; }}
.brand {{ display: flex; align-items: center; gap: 22px; }}
.brand img {{ width: 84px; height: 84px; }}
.mark {{ font-weight: 800; font-size: 46px; letter-spacing: -0.04em; line-height: 1; }}
.kicker {{ font-weight: 500; font-size: 24px; color: {MUTED}; margin-top: 6px; }}
h1 {{ font-weight: 800; font-size: 88px; letter-spacing: -0.045em; line-height: 1.02; margin: auto 0 22px; max-width: 1000px; text-wrap: balance; }}
p {{ font-weight: 450; font-size: 34px; line-height: 1.3; color: {MUTED}; margin: 0; max-width: 960px; text-wrap: pretty; }}
.host {{ margin-top: 40px; font-weight: 650; font-size: 26px; color: {ACCENT}; }}
</style></head><body>
<div class="brand"><img src="{logo}" alt=""><div><div class="mark">{e(mark)}</div>{f'<div class="kicker">{e(kicker)}</div>' if kicker else ""}</div></div>
<h1>{e(headline)}</h1><p>{e(line)}</p><div class="host">{e(host)}</div>
</body></html>"""


def write_cards() -> None:
    chrome = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    name, url = site()
    host = re.sub(r"^https?://", "", url).rstrip("/")
    font = base64.b64encode(inter_woff2().read_bytes()).decode()
    with tempfile.TemporaryDirectory() as scratch:
        for folder, (headline, line, alt) in CARDS.items():
            page = pathlib.Path(scratch) / "card.html"
            page.write_text(card_html(font, name, host, headline, line))
            shot = pathlib.Path(scratch) / "card.png"
            subprocess.run(
                [
                    chrome,
                    "--headless=new",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--no-first-run",
                    "--no-default-browser-check",
                    f"--user-data-dir={scratch}/profile",
                    "--force-device-scale-factor=1",
                    "--window-size=1200,630",
                    "--virtual-time-budget=3000",
                    f"--screenshot={shot}",
                    page.as_uri(),
                ],
                check=True,
                capture_output=True,
            )
            Image.open(shot).convert("RGB").save(folder / "opengraph-image.png", optimize=True)
            (folder / "opengraph-image.alt.txt").write_text(alt)


if __name__ == "__main__":
    write_icons()
    write_cards()
    print("Wrote icons and share images.")
