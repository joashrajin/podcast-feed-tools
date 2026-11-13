// Google Search Console's ownership file, at the exact address Google
// checks. It's a route rather than a file in public/ because Spacefast
// redirects static .html files to the address without .html, and the
// check may not follow that. Keep it, or the site stops being verified.
export function GET() {
  return new Response("google-site-verification: googlebb21c16655b6aa1c.html", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
