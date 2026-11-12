import type { Metadata } from "next";
import { tools } from "@/lib/mcp/tools";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Use with Claude: podcast tools over MCP",
  description:
    "Connect Claude, or any MCP client, to search Pocket Casts, check RSS feeds, list episodes, and compare a feed with Pocket Casts while you debug a show.",
  path: "/connect",
});

const endpoint = `${SITE_URL}/mcp`;

const prompts = [
  "How many episodes does Pocket Casts have for The Daily, and when was the newest one published?",
  "A listener says the latest episode isn't in Pocket Casts: https://pca.st/… Compare the feed with Pocket Casts.",
  "Check this feed and tell me what to fix: https://…/feed.xml",
  "List the last 10 episodes in this feed with their GUIDs and file sizes.",
];

export default function ConnectPage() {
  return (
    <>
      <h1>Use with Claude</h1>
      <p className="lede">
        Connect Claude, or any MCP client, to these tools. Ask about a show while you work and get
        episode counts, the newest episode Pocket Casts has, feed problems, and what&apos;s missing,
        without checking by hand.
      </p>

      <section className="section">
        <h2>Server address</h2>
        <pre className="endpoint"><code>{endpoint}</code></pre>
        <p className="hint">
          Remote MCP server over Streamable HTTP. No sign-in. Every tool only reads.
        </p>
      </section>

      <section className="section">
        <h2>Add it</h2>
        <ol className="steps">
          <li>
            <strong>Claude on the web and desktop</strong>
            <p>
              Open Settings, then Connectors, and add a custom connector with the address above. On a
              Team or Enterprise plan an owner adds custom connectors for the organization, and
              members then turn it on.
            </p>
          </li>
          <li>
            <strong>Claude Code</strong>
            <div>
              <pre className="endpoint"><code>{`claude mcp add --transport http podcast-tools ${endpoint}`}</code></pre>
            </div>
          </li>
          <li>
            <strong>Other clients</strong>
            <p>
              Add a remote server with the address above, using the Streamable HTTP transport and no
              authentication.
            </p>
          </li>
        </ol>
      </section>

      <section className="section">
        <h2>Tools</h2>
        <ol className="steps">
          {tools().map((tool) => (
            <li key={tool.name}>
              <strong>
                {tool.title}
                <br />
                <code className="tool-name">{tool.name}</code>
              </strong>
              <p>{tool.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <h2>Try asking</h2>
        <ul className="prompts">
          {prompts.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>What&apos;s kept</h2>
        <p>
          Nothing. Feed addresses, private ones included, and any username and password are used for
          that one request and not stored or logged. Each address can make 60 tool calls a minute.
        </p>
      </section>
    </>
  );
}
