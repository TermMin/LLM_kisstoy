import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedHostHeader } from "../src/host-validation.js";

const cloudflare = ["*.trycloudflare.com"];

test("allows loopback hosts and genuine trycloudflare subdomains", () => {
  assert.equal(isAllowedHostHeader("127.0.0.1:3000", cloudflare), true);
  assert.equal(isAllowedHostHeader("localhost:3000", cloudflare), true);
  assert.equal(isAllowedHostHeader("random-words.trycloudflare.com", cloudflare), true);
  assert.equal(isAllowedHostHeader("A-B.TRYCLOUDFLARE.COM:443", cloudflare), true);
});

test("rejects suffix confusion, apex domains, malformed hosts, and missing hosts", () => {
  assert.equal(isAllowedHostHeader("trycloudflare.com", cloudflare), false);
  assert.equal(isAllowedHostHeader("eviltrycloudflare.com", cloudflare), false);
  assert.equal(isAllowedHostHeader("abc.trycloudflare.com.evil.test", cloudflare), false);
  assert.equal(isAllowedHostHeader("bad host", cloudflare), false);
  assert.equal(isAllowedHostHeader(undefined, cloudflare), false);
});
