import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";

import { bearerToken, isLocalRequest, isSameOrigin } from "../server/core/http-guard.ts";

const req = (headers: Record<string, string | undefined>, remoteAddress = "127.0.0.1") =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

test("a request with no Origin is allowed", () => {
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:8799" })), true);
});

test("the dev server's origin is allowed", () => {
  assert.equal(
    isLocalRequest(req({ host: "127.0.0.1:8799", origin: "http://localhost:5199" })),
    true,
  );
  assert.equal(
    isLocalRequest(req({ host: "localhost:8799", origin: "http://127.0.0.1:5199" })),
    true,
  );
});

test("a website cannot post to the harness", () => {
  for (const origin of [
    "https://evil.example",
    "http://evil.example:8799",
    "http://127.0.0.1.evil.example",
    "http://localhost.evil.example",
    "http://evil.example/#127.0.0.1",
  ]) {
    assert.equal(
      isLocalRequest(req({ host: "127.0.0.1:8799", origin })),
      false,
      `${origin} should be rejected`,
    );
  }
});

test("a rebound DNS name cannot reach the harness", () => {
  assert.equal(isLocalRequest(req({ host: "attacker.example:8799" })), false);
  assert.equal(isLocalRequest(req({ host: "attacker.example" })), false);
});

test("a forged Host from off-loopback is rejected on the peer address", () => {
  assert.equal(
    isLocalRequest(req({ host: "localhost:8799" }, "192.168.1.50")),
    false,
    "a forged Host from a LAN peer must not be treated as local",
  );
  assert.equal(
    isLocalRequest(req({ host: "127.0.0.1:8799" }, "10.0.0.9")),
    false,
  );
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:8799" }, "::ffff:127.0.0.1")), true);
});

test("a request with no Host is rejected", () => {
  assert.equal(isLocalRequest(req({})), false);
  assert.equal(isLocalRequest(req({ host: "" })), false);
});

test("an opaque origin is allowed, since it cannot be a site", () => {
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:8799", origin: "null" })), true);
});

test("a malformed Origin is rejected rather than ignored", () => {
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:8799", origin: "not a url" })), false);
});

test("IPv6 loopback is recognised on both sides", () => {
  assert.equal(isLocalRequest(req({ host: "[::1]:8799", origin: "http://[::1]:5199" })), true);
});

test("a bearer token is read, and anything else is not", () => {
  assert.equal(bearerToken(req({ authorization: "Bearer abc123" })), "abc123");
  assert.equal(bearerToken(req({ authorization: "bearer abc123" })), "abc123");
  assert.equal(bearerToken(req({ authorization: "Bearer   abc123  " })), "abc123");

  assert.equal(bearerToken(req({})), null);
  assert.equal(bearerToken(req({ authorization: "" })), null);
  assert.equal(bearerToken(req({ authorization: "abc123" })), null);
  assert.equal(bearerToken(req({ authorization: "Basic abc123" })), null);
  assert.equal(bearerToken(req({ authorization: "Bearer" })), null);
  assert.equal(bearerToken(req({ authorization: "Bearer " })), null);
});

test("same origin means the page we served, or no page at all", () => {
  assert.equal(isSameOrigin(req({ host: "192.168.1.20:8799" })), true);
  assert.equal(isSameOrigin(req({ host: "192.168.1.20:8799", origin: "null" })), true);
  assert.equal(
    isSameOrigin(req({ host: "192.168.1.20:8799", origin: "http://192.168.1.20:8799" })),
    true,
  );
});

test("another site's script is not same origin, whatever it carries", () => {
  const host = "192.168.1.20:8799";
  assert.equal(isSameOrigin(req({ host, origin: "https://evil.example" })), false);
  assert.equal(isSameOrigin(req({ host, origin: "http://192.168.1.20:9999" })), false);
  assert.equal(isSameOrigin(req({ host, origin: "http://192.168.1.200:8799" })), false);
  assert.equal(isSameOrigin(req({ host, origin: "not a url" })), false);
});
