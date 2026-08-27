import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseKisstoyRemoteTarget, publicConfig } from "../src/config.js";

const remoteUrl =
  "https://api.app.knightjenay.cn/kisstoy/remote/#/?device_id=18&group=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&id=123456&lang=zh";

test("parses the public remote URL without retaining it in public output", () => {
  const config = loadConfig({ KISSTOY_REMOTE_URL: remoteUrl });
  assert.equal(config.group, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(config.deviceId, "18");
  assert.equal(config.bindingId, "123456");
  assert.equal(config.liveControl, false);
  assert.equal(config.maxIntensity, 100);
  assert.equal(config.maxDurationMs, 300_000);
  assert.equal(config.armTtlSeconds, 3_600);
  assert.equal(publicConfig(config).session_fingerprint.length, 10);
  assert.equal(JSON.stringify(publicConfig(config)).includes(config.group), false);
});

test("parses a Cathy III share link as device 17 without exposing its group", () => {
  const target = parseKisstoyRemoteTarget(
    "https://api.app.knightjenay.cn/kisstoy/remote/#/?device_id=17&group=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&id=840781&lang=zh",
  );
  assert.equal(target.deviceId, "17");
  assert.equal(target.bindingId, "840781");
  assert.equal(target.websocketUrl, "wss://api.app.knightjenay.cn/websocket-kisstoy");
});

test("rejects live, public HTTP control without a bearer token", () => {
  assert.throws(
    () =>
      loadConfig({
        KISSTOY_REMOTE_URL: remoteUrl,
        KISSTOY_LIVE_CONTROL: "true",
        MCP_HOST: "0.0.0.0",
      }),
    /MCP_BEARER_TOKEN/,
  );
});

test("rejects an unexpected API origin by default", () => {
  assert.throws(
    () =>
      loadConfig({
        KISSTOY_REMOTE_URL:
          "https://example.com/kisstoy/remote/#/?device_id=18&group=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    /unexpected Kisstoy origin/,
  );
});
