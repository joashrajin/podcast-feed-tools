import SourcePage, { sourceMetadata } from "../source-page";

export const metadata = sourceMetadata("spotify-podcast-rss-feed");

export default function Page() {
  return <SourcePage slug="spotify-podcast-rss-feed" />;
}
