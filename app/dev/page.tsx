import type { Metadata } from "next";
import { tools } from "@/lib/mcp/tools";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL, SITE_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Developers: connect an AI assistant over MCP",
  description:
    "An open MCP server for any AI assistant or MCP client: find RSS feeds, search Pocket Casts, check feeds, list episodes, and compare a feed with Pocket Casts.",
  path: "/dev",
});

const endpoint = `${SITE_URL}/mcp`;

const jsonConfig = JSON.stringify({ mcpServers: { "podcast-tools": { url: endpoint } } }, null, 2);

const curlExample = `curl -s ${endpoint} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"find_feed_url",
                 "arguments":{"link":"https://www.youtube.com/@mkbhd"}}}'`;

const prompts = [
  "Find the RSS feed for this YouTube channel: https://www.youtube.com/@…",
  "How many episodes does Pocket Casts have for The Daily, and when was the newest one published?",
  "A listener says the latest episode isn't in Pocket Casts: https://pca.st/… Compare the feed with Pocket Casts.",
  "Check this feed and tell me what to fix: https://…/feed.xml",
];

export default function DevPage() {
  return (
    <>
      <h1>Connect an AI assistant</h1>
      <p className="lede">
        Every tool on this site is also an MCP server, so any AI assistant or MCP client can use it.
        Ask about a feed while you work instead of looking it up by hand.
      </p>

      <section className="section">
        <h2>Server address</h2>
        <pre className="endpoint"><code>{endpoint}</code></pre>
        <p className="hint">
          Remote MCP server over Streamable HTTP. No sign-in, no API key. Every tool only reads.
        </p>
      </section>

      <section className="section">
        <h2>Add it</h2>
        <ol className="steps">
          <li>
            <strong>AI assistants</strong>
            <p>
              Any assistant that accepts custom MCP servers can use it. Open its connector, app, or
              MCP settings, add a remote server, and paste the address above. Organization plans may
              need an admin to allow it first.
            </p>
          </li>
          <li>
            <strong>Editors and agents</strong>
            <div>
              <p>
                Editors and agents configured with an <code>mcpServers</code> file take a remote
                entry like this. Some name the key <code>httpUrl</code> or ask for{" "}
                <code>{`"type": "http"`}</code>.
              </p>
              <pre className="endpoint"><code>{jsonConfig}</code></pre>
            </div>
          </li>
          <li>
            <strong>Command-line agents</strong>
            <p>
              Agents with an &ldquo;add MCP server&rdquo; command take the address with the HTTP
              transport. Name the server <code>podcast-tools</code>, or anything you like.
            </p>
          </li>
          <li>
            <strong>No client</strong>
            <div>
              <p>It&apos;s plain JSON-RPC over HTTP, so a script can call a tool directly:</p>
              <pre className="endpoint"><code>{curlExample}</code></pre>
            </div>
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
          The code is on <a href={REPO_URL}>GitHub</a>.
        </p>
      </section>
    </>
  );
}
