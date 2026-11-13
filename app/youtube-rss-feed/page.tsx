import SourcePage, { sourceMetadata } from "../source-page";

export const metadata = sourceMetadata("youtube-rss-feed");

export default function Page() {
  return <SourcePage slug="youtube-rss-feed" />;
}
