import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPublicHttpUrl, FetchError, isBlockedIp, safeFetch } from "../lib/net";

describe("public address checks", () => {
  it("blocks loopback, link-local, private, and non-canonical addresses", () => {
    assert.equal(isBlockedIp("127.0.0.1"), true);
    assert.equal(isBlockedIp("10.1.2.3"), true);
    assert.equal(isBlockedIp("192.168.1.9"), true);
    assert.equal(isBlockedIp("169.254.169.254"), true);
    assert.equal(isBlockedIp("172.16.0.1"), true);
    assert.equal(isBlockedIp("::1"), true);
    assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedIp("8.8.8.8"), false);
    assert.equal(isBlockedIp("2001:4860:4860::8888"), false);

    for (const raw of [
      "http://127.0.0.1/feed",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://2130706433/",
      "http://127.1/",
      "http://0177.0.0.1/",
      "http://localhost/feed",
      "http://user:pass@example.com/",
      "file:///etc/passwd",
      "http://metadata.google.internal/",
    ]) {
      assert.throws(() => assertPublicHttpUrl(raw), FetchError, raw);
    }
  });

  it("accepts a normal public https URL and enforces a host allow-list", () => {
    const url = assertPublicHttpUrl("https://itunes.apple.com/lookup?id=1");
    assert.equal(url.hostname, "itunes.apple.com");
    assert.throws(
      () => assertPublicHttpUrl("https://evil.example/lookup", ["itunes.apple.com"]),
      FetchError
    );
  });

  it("refuses a loopback fetch before connecting", async () => {
    await assert.rejects(
      () => safeFetch("http://127.0.0.1/", { userAgent: "test" }),
      (err: unknown) => err instanceof FetchError && err.code === "blocked"
    );
  });
});
