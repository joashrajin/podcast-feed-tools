import SourcePage, { sourceMetadata } from "../source-page";

export const metadata = sourceMetadata("pocket-casts-rss-feed");

export default function Page() {
  return <SourcePage slug="pocket-casts-rss-feed" />;
}
