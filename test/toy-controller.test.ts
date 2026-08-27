import assert from "node:assert/strict";
import test from "node:test";
import type { KisstoyConfig } from "../src/config.js";
import type { DeviceCapabilities, MotorType, ToyClientPort } from "../src/kisstoy-client.js";
import { ToyController } from "../src/toy-controller.js";

class FakeClient implements ToyClientPort {
  online = true;
  commands: Array<{ type: MotorType; intensity: number }> = [];
  stopCalls = 0;

  async getCapabilities(): Promise<DeviceCapabilities> {
    throw new Error("not used");
  }
  async getOnlineStatus(): Promise<boolean> {
    return this.online;
  }
  async setMotor(type: MotorType, intensity: number): Promise<void> {
    this.commands.push({ type, intensity });
  }
  async stopAll(): Promise<void> {
    this.stopCalls += 1;
  }
  async close(): Promise<void> {}
  connectionState(): string {
    return "connected";
  }
}

function config(liveControl: boolean): KisstoyConfig {
  return {
    apiOrigin: "https://api.app.knightjenay.cn",
    websocketUrl: "wss://api.app.knightjenay.cn/websocket-kisstoy",
    group: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    deviceId: "18",
    liveControl,
    maxIntensity: 60,
    maxDurationMs: 30_000,
    armTtlSeconds: 120,
    maxCommandsPerMinute: 20,
    mcpHost: "127.0.0.1",
    mcpPort: 3000,
  };
}

test("dry-run quantizes intensity and never calls the physical client", async () => {
  const client = new FakeClient();
  const controller = new ToyController(config(false), client);
  const armed = controller.guard.arm(true, true);
  const result = await controller.setMotor(armed.token, 1, 23, 1_000);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.motor, "secondary_thrust");
  assert.equal(result.appliedIntensity, 20);
  assert.deepEqual(client.commands, []);
  await controller.stopAll();
});

test("live mode checks online state before sending a bounded command", async () => {
  const client = new FakeClient();
  const controller = new ToyController(config(true), client);
  const armed = controller.guard.arm(true, true);
  const result = await controller.setMotor(armed.token, 4, 25, 1_000);
  assert.equal(result.mode, "live");
  assert.deepEqual(client.commands, [{ type: 4, intensity: 25 }]);
  await controller.stopAll();
  assert.equal(client.stopCalls, 1);
});

test("rejects intensity above the configured maximum", async () => {
  const client = new FakeClient();
  const controller = new ToyController(config(false), client);
  const armed = controller.guard.arm(true, true);
  await assert.rejects(() => controller.setMotor(armed.token, 1, 65, 1_000), /configured maximum/);
});
