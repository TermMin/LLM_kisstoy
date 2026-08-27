import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { KisstoyConfig } from "../src/config.js";
import type { DeviceCapabilities, MotorType, ToyClientPort } from "../src/kisstoy-client.js";
import { createKisstoyMcpServer } from "../src/mcp-server.js";
import { ToyController } from "../src/toy-controller.js";

class FakeClient implements ToyClientPort {
  async getCapabilities(): Promise<DeviceCapabilities> {
    return {
      id: 18,
      code: "QCTT",
      name: "TUTU II",
      localName: { zh: "突突二代", en: "TUTU II" },
      motors: [
        { type: 1, name: "vibration", startUp: 0.2 },
        { type: 4, name: "thrust", startUp: 0.2 },
      ],
      supportHeating: false,
      supportLighting: false,
    };
  }
  async getOnlineStatus(): Promise<boolean> {
    return true;
  }
  async setMotor(_type: MotorType, _intensity: number): Promise<void> {}
  async stopAll(): Promise<void> {}
  async close(): Promise<void> {}
  connectionState(): string {
    return "connected";
  }
}

const config: KisstoyConfig = {
  apiOrigin: "https://api.app.knightjenay.cn",
  websocketUrl: "wss://api.app.knightjenay.cn/websocket-kisstoy",
  group: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  deviceId: "18",
  liveControl: false,
  maxIntensity: 60,
  maxDurationMs: 30_000,
  armTtlSeconds: 120,
  maxCommandsPerMinute: 20,
  mcpHost: "127.0.0.1",
  mcpPort: 3000,
};

test("advertises focused tools and completes a dry-run command through MCP", async () => {
  const toyClient = new FakeClient();
  const controller = new ToyController(config, toyClient);
  const server = createKisstoyMcpServer(config, toyClient, controller);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "arm_control",
        "disarm_control",
        "get_device_capabilities",
        "get_device_status",
        "identify_device_link",
        "set_secondary_thrust",
        "set_suction",
        "set_thrust",
        "stop_all",
        "switch_device_link",
      ],
    );

    const armed = await client.callTool({
      name: "arm_control",
      arguments: { adult_confirmed: true, wearer_consent_confirmed: true, ttl_seconds: 15 },
    });
    const armedData = armed.structuredContent as { control_token: string };
    assert.ok(armedData.control_token.length >= 20);

    const command = await client.callTool({
      name: "set_secondary_thrust",
      arguments: { control_token: armedData.control_token, intensity: 23, duration_ms: 1_000 },
    });
    assert.deepEqual(command.structuredContent, {
      mode: "dry-run",
      motor: "secondary_thrust",
      requested_intensity: 23,
      applied_intensity: 20,
      duration_ms: 1_000,
      auto_stop_scheduled: true,
    });
  } finally {
    await client.close();
    await server.close();
    await controller.stopAll();
  }
});

test("identifies and switches to Cathy III before using its suction strategy", async () => {
  const localConfig = { ...config };
  const toyClient = new FakeClient();
  const controller = new ToyController(localConfig, toyClient);
  const server = createKisstoyMcpServer(localConfig, toyClient, controller);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const cathyUrl =
    "https://api.app.knightjenay.cn/kisstoy/remote/#/?device_id=17&group=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&id=840781&lang=zh";

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const identified = await client.callTool({
      name: "identify_device_link",
      arguments: { remote_url: cathyUrl },
    });
    assert.deepEqual(identified.structuredContent, {
      device_id: "17",
      supported: true,
      device_name: "Cathy III",
      device_name_zh: "Cathy III",
      device_code: "KX02",
      channels: [
        {
          type: 3,
          semantic_name: "suction",
          semantic_name_zh: "吮吸",
          page_label_zh: "吮吸",
          position: "top",
          mcp_tool: "set_suction",
        },
        {
          type: 4,
          semantic_name: "thrust",
          semantic_name_zh: "抽插",
          page_label_zh: "抽插",
          position: "bottom",
          mcp_tool: "set_thrust",
        },
      ],
      session_fingerprint: (identified.structuredContent as { session_fingerprint: string })
        .session_fingerprint,
      matches_active_target: false,
    });
    assert.equal(localConfig.deviceId, "18");

    const oldArm = await client.callTool({
      name: "arm_control",
      arguments: { adult_confirmed: true, wearer_consent_confirmed: true, ttl_seconds: 15 },
    });
    const oldControlToken = (oldArm.structuredContent as { control_token: string }).control_token;

    const switched = await client.callTool({
      name: "switch_device_link",
      arguments: { remote_url: cathyUrl },
    });
    assert.equal((switched.structuredContent as { active: boolean }).active, true);
    assert.equal(localConfig.deviceId, "17");
    assert.equal(localConfig.group, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    const expiredOldSession = await client.callTool({
      name: "set_suction",
      arguments: { control_token: oldControlToken, intensity: 20, duration_ms: 1_000 },
    });
    assert.equal(expiredOldSession.isError, true);

    const armed = await client.callTool({
      name: "arm_control",
      arguments: { adult_confirmed: true, wearer_consent_confirmed: true, ttl_seconds: 15 },
    });
    const controlToken = (armed.structuredContent as { control_token: string }).control_token;

    const wrongStrategy = await client.callTool({
      name: "set_secondary_thrust",
      arguments: { control_token: controlToken, intensity: 20, duration_ms: 1_000 },
    });
    assert.equal(wrongStrategy.isError, true);

    const suction = await client.callTool({
      name: "set_suction",
      arguments: { control_token: controlToken, intensity: 23, duration_ms: 1_000 },
    });
    assert.equal(suction.isError, undefined);
    assert.equal((suction.structuredContent as { motor: string }).motor, "suction");
  } finally {
    await client.close();
    await server.close();
    await controller.stopAll();
  }
});

test("describes the TUTU II channel semantics for LLM tool selection", async () => {
  const toyClient = new FakeClient();
  const controller = new ToyController(config, toyClient);
  const server = createKisstoyMcpServer(config, toyClient, controller);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    const secondary = listed.tools.find((tool) => tool.name === "set_secondary_thrust");
    assert.match(secondary?.description ?? "", /TOP channel/);
    assert.match(secondary?.description ?? "", /震动/);
    assert.match(secondary?.description ?? "", /二次抽插/);

    const capabilities = await client.callTool({ name: "get_device_capabilities", arguments: {} });
    const data = capabilities.structuredContent as {
      name: string;
      local_name: { zh?: string };
      motors: Array<Record<string, unknown>>;
    };
    assert.equal(data.name, "TUTU II");
    assert.equal(data.local_name.zh, "突突二代");
    assert.deepEqual(data.motors[0], {
      type: 1,
      name: "secondary_thrust",
      protocol_name: "vibration",
      semantic_name_zh: "二次抽插",
      page_label_zh: "震动",
      position: "top",
      mcp_tool: "set_secondary_thrust",
      aliases_zh: ["震动", "顶部", "顶部通道", "二次抽插"],
      start_up: 0.2,
    });
    assert.equal(data.motors[1]?.name, "thrust");
    assert.equal(data.motors[1]?.page_label_zh, "抽插");
  } finally {
    await client.close();
    await server.close();
    await controller.stopAll();
  }
});
