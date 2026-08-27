import assert from "node:assert/strict";
import test from "node:test";
import { ControlGuard } from "../src/control-guard.js";

test("requires both adult confirmation and wearer consent", () => {
  const guard = new ControlGuard(120, 20);
  assert.throws(() => guard.arm(false, true), /must both be confirmed/);
  assert.throws(() => guard.arm(true, false), /must both be confirmed/);
});

test("expires an armed token and rejects later commands", () => {
  let now = 1_000;
  const guard = new ControlGuard(120, 20, () => now);
  const armed = guard.arm(true, true, 15);
  guard.validate(armed.token);
  now += 15_001;
  assert.throws(() => guard.validate(armed.token), /expired/);
  assert.equal(guard.status().armed, false);
});

test("rate-limits physical commands", () => {
  const guard = new ControlGuard(120, 2, () => 1_000);
  const armed = guard.arm(true, true);
  guard.consumeCommand(armed.token);
  guard.consumeCommand(armed.token);
  assert.throws(() => guard.consumeCommand(armed.token), /rate limit/);
});
