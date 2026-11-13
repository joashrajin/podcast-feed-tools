import SourcePage, { sourceMetadata } from "../source-page";

export const metadata = sourceMetadata("soundcloud-rss-feed");

export default function Page() {
  return <SourcePage slug="soundcloud-rss-feed" />;
}
