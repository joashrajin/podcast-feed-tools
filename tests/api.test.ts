import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientKey, readLimitedBytes } from "../lib/api";

describe("request guards", () => {
  it("ignores a spoofed X-Forwarded-For and uses CF-Connecting-IP", () => {
    assert.equal(
      clientKey({ headers: new Headers({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "8.8.8.8" }) }),
      "8.8.8.8"
    );
    assert.equal(clientKey({ headers: new Headers({ "x-forwarded-for": "1.2.3.4" }) }), "local");
  });

  it("cancels a body once the byte cap is passed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await readLimitedBytes(stream, 1000);
    assert.equal(result, "too-large");
    assert.equal(cancelled, true);
  });
});
