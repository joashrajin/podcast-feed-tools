// One landing page per kind of link the finder takes. Each page has the
// finder, the link formats that work, how the feed is found, and what to know
// about the feed it gives. Keep these in step with lib/resolve.ts and
// lib/discover.ts: a page must not promise a link the code doesn't handle.

export type SourcePage = {
  /** Path segment, and the page's address. */
  slug: string;
  /** Short name, for links to the page. */
  name: string;
  title: string;
  description: string;
  heading: string;
  lede: string;
  /** Placeholder for the finder's box. */
  hint: string;
  /** Link formats the finder accepts for this source. */
  links: string[];
  steps: { title: string; text: string }[];
  notes: { q: string; a: string }[];
};

export const SOURCE_PAGES: SourcePage[] = [
  {
    slug: "youtube-rss-feed",
    name: "YouTube",
    title: "YouTube RSS feed: find a channel's or playlist's feed",
    description:
      "Paste a YouTube channel, @handle, playlist, or video link and get its RSS feed URL for any feed reader. Free, no sign-up.",
    heading: "Find a YouTube RSS feed",
    lede: "Every YouTube channel and public playlist has an RSS feed, but YouTube doesn't link to it. Paste a link to get the address.",
    hint: "youtube.com/@channel",
    links: [
      "A handle: youtube.com/@name",
      "A channel: youtube.com/channel/UC…, /c/name, or /user/name",
      "A video, Short, or live stream: youtube.com/watch?v=…, youtu.be/…, /shorts/…, or /live/…, which finds its channel",
      "A playlist: youtube.com/playlist?list=…",
      "YouTube Music links to the same channels and playlists",
    ],
    steps: [
      {
        title: "Find the channel",
        text: "A channel's id starts with UC. A handle, custom address, or video is read for that id first.",
      },
      {
        title: "Build the feed",
        text: "A channel's feed is youtube.com/feeds/videos.xml?channel_id= and its id. A playlist's is the same address with playlist_id= and the list id.",
      },
      {
        title: "Subscribe",
        text: "Paste the feed address into a feed reader to see new videos as they're published, without a YouTube account.",
      },
    ],
    notes: [
      {
        q: "Can a podcast app play it?",
        a: "No. The feed links to each video's page and has no audio file, so podcast apps can't play it. Feed readers can.",
      },
      {
        q: "How many videos does it list?",
        a: "Only the latest, about 15. It's for following new videos, not for reading a channel's whole history.",
      },
      {
        q: "Are private or unlisted videos included?",
        a: "No. The feed lists public videos only, and a private playlist has no feed.",
      },
    ],
  },
  {
    slug: "soundcloud-rss-feed",
    name: "SoundCloud",
    title: "SoundCloud RSS feed: find a creator's feed URL",
    description:
      "Paste a SoundCloud profile, track, or short link and get the account's RSS feed, for a podcast app or a podcast directory. Free, no sign-up.",
    heading: "Find a SoundCloud RSS feed",
    lede: "Every SoundCloud account has an RSS feed. Paste a profile, track, or short link to get its address.",
    hint: "soundcloud.com/artist",
    links: [
      "A profile: soundcloud.com/name",
      "A track: soundcloud.com/name/track, which finds its account",
      "A short link: on.soundcloud.com/…",
      "Mobile links: m.soundcloud.com/…",
    ],
    steps: [
      {
        title: "Find the account",
        text: "The link leads to the profile page, which holds the account's number.",
      },
      {
        title: "Build the feed",
        text: "The feed is feeds.soundcloud.com/users/soundcloud:users: with that number, then /sounds.rss. It's fetched once to confirm it answers.",
      },
      {
        title: "Use it",
        text: "Add it to a podcast app, or give it to podcast directories if the account is your podcast.",
      },
    ],
    notes: [
      {
        q: "Why is the feed empty?",
        a: "It only has the tracks the creator includes in RSS. On SoundCloud that's under Settings, then Content. An account that hasn't set it up has a valid feed with no episodes.",
      },
      {
        q: "Is this my podcast's feed?",
        a: "If you publish your podcast on SoundCloud, yes. This is the address podcast directories ask for.",
      },
    ],
  },
  {
    slug: "apple-podcasts-rss-feed",
    name: "Apple Podcasts",
    title: "Apple Podcasts RSS feed: get the feed behind any show",
    description:
      "Paste an Apple Podcasts show or episode link and get the podcast's RSS feed URL, to use in another app or check. Free, no sign-up.",
    heading: "Find the RSS feed of an Apple Podcasts show",
    lede: "Apple Podcasts knows the RSS feed behind almost every show, but doesn't display it. Paste a show or episode link to get the address.",
    hint: "podcasts.apple.com/…/id123456789",
    links: [
      "A show: podcasts.apple.com/us/podcast/name/id123456789",
      "An episode: the same link with ?i=…, which finds its show",
      "Links from any country's store",
    ],
    steps: [
      {
        title: "Read the id",
        text: "The number after id in the link is the show.",
      },
      {
        title: "Ask Apple",
        text: "Your browser asks Apple's public lookup for that show, so Apple sees your own connection. Its answer includes the feed address.",
      },
      {
        title: "Check it",
        text: "This site confirms the address is a public web address before showing it.",
      },
    ],
    notes: [
      {
        q: "Why is there no feed?",
        a: "Some shows published only through Apple, such as subscription-only shows, have no public feed, so Apple's lookup lists none.",
      },
      {
        q: "Can I use the feed in another app?",
        a: "Yes. Most podcast apps, Pocket Casts included, can add a show by its feed address.",
      },
    ],
  },
  {
    slug: "spotify-podcast-rss-feed",
    name: "Spotify",
    title: "Spotify podcast RSS feed: find the feed behind a show",
    description:
      "Paste a Spotify podcast or episode link to find the show's public RSS feed and listen in any podcast app. Free, no sign-up.",
    heading: "Find the RSS feed of a Spotify podcast",
    lede: "Spotify doesn't publish RSS feeds, but most shows on Spotify have one. Paste a show or episode link to find it.",
    hint: "open.spotify.com/show/…",
    links: ["A show: open.spotify.com/show/…", "An episode: open.spotify.com/episode/…, which finds its show"],
    steps: [
      {
        title: "Read the show",
        text: "The show's name and publisher come from its Spotify page, or for an episode, from the episode's player.",
      },
      {
        title: "Match it",
        text: "The exact name is looked up in Apple Podcasts, from your browser. A different publisher isn't accepted, and when several shows fit you see them all instead of a guess.",
      },
      {
        title: "Get the feed",
        text: "The matched show's RSS feed is the one its publisher sends to podcast apps.",
      },
    ],
    notes: [
      {
        q: "Why can't some shows be found?",
        a: "Spotify exclusives have no public feed. A show whose title differs on Spotify and Apple Podcasts won't match either.",
      },
      {
        q: "Is it the same feed Spotify reads?",
        a: "Usually. Most shows publish one feed that Spotify, Apple Podcasts, and other apps all read.",
      },
    ],
  },
  {
    slug: "pocket-casts-rss-feed",
    name: "Pocket Casts",
    title: "Pocket Casts RSS feed: get the feed behind any show",
    description:
      "Paste a Pocket Casts show, episode, or pca.st share link and get the podcast's RSS feed URL. Free, no sign-up.",
    heading: "Find the RSS feed of a Pocket Casts show",
    lede: "A Pocket Casts share link opens a show, not its feed. Paste one to get the RSS address behind it.",
    hint: "pca.st/… or pocketcasts.com/podcast/…",
    links: [
      "A share link: pca.st/…",
      "A show: pocketcasts.com/podcast/name/…",
      "An episode share link, which finds its show",
      "Web player links: play.pocketcasts.com/…",
    ],
    steps: [
      {
        title: "Find the show",
        text: "A share link is followed to the show, and the Pocket Casts catalog gives its name, publisher, and address.",
      },
      {
        title: "Use the catalog",
        text: "When that address is itself a feed, it's the answer.",
      },
      {
        title: "Match by name",
        text: "Otherwise the exact title and publisher are matched in Apple Podcasts. When several shows share the name, the feed with Pocket Casts' newest episode wins.",
      },
    ],
    notes: [
      {
        q: "Why won't a private show work?",
        a: "Private shows, such as members-only feeds, aren't in the public catalog, so there's no address to give.",
      },
      {
        q: "Can I check the feed too?",
        a: "Yes. The result links to the feed checker, which lists the problems that stop a show updating in podcast apps.",
      },
    ],
  },
  {
    slug: "website-rss-feed",
    name: "Blogs & websites",
    title: "Find the RSS feed of any website or blog",
    description:
      "Paste a blog, news site, Substack, Medium, or any website link to find its RSS or Atom feed, even when the site doesn't show one. Free, no sign-up.",
    heading: "Find a website's RSS feed",
    lede: "Most blogs and news sites have an RSS feed, even when they don't link to it. Paste any page to find it.",
    hint: "example.com",
    links: [
      "Any page or homepage, with or without https://",
      "Substack, Medium, Tumblr, Blogger, WordPress.com, and Ghost blogs",
      "Subreddits: reddit.com/r/…",
      "GitHub repositories, for their releases feed",
      "A feed address itself, to confirm it works",
    ],
    steps: [
      {
        title: "Read the page",
        text: "Feeds the page lists in its own head come first, comment feeds last.",
      },
      {
        title: "Try known patterns",
        text: "Hosts like Substack, Medium, and Blogger keep feeds at fixed addresses, so those are tried next.",
      },
      {
        title: "Try common addresses",
        text: "Last, the usual places: /feed, /rss.xml, /atom.xml, /index.xml, and others, under the page's own path first.",
      },
    ],
    notes: [
      {
        q: "What if a site has several feeds?",
        a: "The first that answers is the result. The other feeds the page lists, such as categories or comments, appear underneath.",
      },
      {
        q: "Why does a site say it has no feed?",
        a: "Some sites don't publish one, and some block automated requests. Try the blog or news section's own page instead of the homepage.",
      },
    ],
  },
];

export function sourcePage(slug: string): SourcePage {
  const page = SOURCE_PAGES.find((item) => item.slug === slug);
  if (!page) throw new Error(`No source page ${slug}`);
  return page;
}
