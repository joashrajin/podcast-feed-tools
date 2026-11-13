import SourcePage, { sourceMetadata } from "../source-page";

export const metadata = sourceMetadata("website-rss-feed");

export default function Page() {
  return <SourcePage slug="website-rss-feed" />;
}
