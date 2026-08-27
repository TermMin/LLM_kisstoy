import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KisstoyConfig } from "./config.js";
import { parseKisstoyRemoteTarget, publicConfig } from "./config.js";
import { getDeviceProfile, getMotorChannelProfile } from "./device-profile.js";
import type { ToyClientPort } from "./kisstoy-client.js";
import { ToyController } from "./toy-controller.js";

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createKisstoyMcpServer(
  config: KisstoyConfig,
  client: ToyClientPort,
  controller: ToyController,
): McpServer {
  const activeDeviceProfile = () => getDeviceProfile(config.deviceId);
  const describeChannels = (deviceId: string) =>
    (getDeviceProfile(deviceId)?.channels ?? []).map((channel) => ({
      type: channel.type,
      semantic_name: channel.semanticKey,
      semantic_name_zh: channel.semanticNameZh,
      page_label_zh: channel.pageLabelZh,
      position: channel.position,
      mcp_tool: channel.mcpTool,
    }));
  const inspectRemoteLink = (remoteUrl: string) => {
    const target = parseKisstoyRemoteTarget(remoteUrl);
    const profile = getDeviceProfile(target.deviceId);
    const safe = publicConfig({ ...config, ...target });
    return {
      target,
      profile,
      publicInfo: {
        device_id: target.deviceId,
        supported: profile !== undefined,
        device_name: profile?.nameEn ?? "Unknown device",
        device_name_zh: profile?.nameZh ?? "未知设备",
        device_code: profile?.code ?? "",
        channels: describeChannels(target.deviceId),
        session_fingerprint: safe.session_fingerprint,
        matches_active_target: target.deviceId === config.deviceId && target.group === config.group,
      },
    };
  };

  const server = new McpServer(
    { name: "kisstoy-multi-device", version: "0.2.0" },
    {
      instructions:
        "Controls supported Kisstoy devices selected from their share links. When the user supplies a new share link, call identify_device_link, then switch_device_link before arming. Device 18 is 突突二代 (TUTU II): top webpage 震动 means 二次抽插 via set_secondary_thrust; bottom 抽插 uses set_thrust. Device 17 is Cathy III: top 吮吸 uses set_suction; bottom 抽插 uses set_thrust. Never call a channel tool that is not listed for the active device. Ask for adult status and the current wearer's explicit consent once, immediately before arm_control. During that armed control session, do not ask for repeated confirmation before set_* actions unless consent is withdrawn, uncertain, or the session expires. Use bounded duration and intensity. stop_all is always safe to call immediately.",
    },
  );

  server.registerTool(
    "get_device_status",
    {
      title: "Get active Kisstoy status",
      description: "Check the active Kisstoy device identity, channel strategy, and online status. This never moves the device.",
      inputSchema: {},
      outputSchema: {
        online: z.boolean(),
        connection_state: z.string(),
        live_control: z.boolean(),
        armed: z.boolean(),
        arm_expires_at: z.string().optional(),
        device_id: z.string(),
        device_name: z.string(),
        device_name_zh: z.string(),
        channels: z.array(
          z.object({
            type: z.number(),
            semantic_name: z.string(),
            semantic_name_zh: z.string(),
            page_label_zh: z.string(),
            position: z.enum(["top", "bottom"]),
            mcp_tool: z.string(),
          }),
        ),
        session_fingerprint: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const online = await client.getOnlineStatus();
        const arm = controller.guard.status();
        const safe = publicConfig(config);
        const result = {
          online,
          connection_state: client.connectionState(),
          live_control: config.liveControl,
          armed: arm.armed,
          ...(arm.expiresAt ? { arm_expires_at: arm.expiresAt } : {}),
          device_id: safe.device_id,
          device_name: activeDeviceProfile()?.nameEn ?? "Unknown device",
          device_name_zh: activeDeviceProfile()?.nameZh ?? "未知设备",
          channels: describeChannels(config.deviceId),
          session_fingerprint: safe.session_fingerprint,
        };
        return textResult(
          `${activeDeviceProfile()?.nameZh ?? "Kisstoy"} session is ${online ? "online" : "offline"}; control mode is ${config.liveControl ? "live" : "dry-run"}.`,
          result,
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  const deviceLinkOutputSchema = {
    device_id: z.string(),
    supported: z.boolean(),
    device_name: z.string(),
    device_name_zh: z.string(),
    device_code: z.string(),
    channels: z.array(
      z.object({
        type: z.number(),
        semantic_name: z.string(),
        semantic_name_zh: z.string(),
        page_label_zh: z.string(),
        position: z.enum(["top", "bottom"]),
        mcp_tool: z.string(),
      }),
    ),
    session_fingerprint: z.string(),
    matches_active_target: z.boolean(),
  };

  server.registerTool(
    "identify_device_link",
    {
      title: "Identify Kisstoy share link",
      description:
        "Parse a user-supplied Kisstoy share link, identify the device model, and return the correct MCP channel strategy. This never connects, stores the link, or moves a device.",
      inputSchema: {
        remote_url: z.string().url().describe("A complete Kisstoy share link explicitly supplied by the user."),
      },
      outputSchema: deviceLinkOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async ({ remote_url }) => {
      try {
        const inspected = inspectRemoteLink(remote_url);
        return textResult(
          inspected.profile
            ? `Identified ${inspected.profile.nameZh} (device ${inspected.target.deviceId}).`
            : `Device ${inspected.target.deviceId} is not yet supported.`,
          inspected.publicInfo,
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "switch_device_link",
    {
      title: "Switch active Kisstoy share link",
      description:
        "Switch the in-memory control target to a supported Kisstoy share link explicitly supplied by the user. Safely stops and disconnects the previous target, invalidates its control token, and does not persist or echo the link. Call identify_device_link first.",
      inputSchema: {
        remote_url: z.string().url().describe("A complete Kisstoy share link explicitly supplied by the user."),
      },
      outputSchema: {
        ...deviceLinkOutputSchema,
        active: z.literal(true),
        live_control: z.boolean(),
        requires_rearm: z.literal(true),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ remote_url }) => {
      try {
        const inspected = inspectRemoteLink(remote_url);
        if (!inspected.profile) {
          throw new Error(`Kisstoy device_id ${inspected.target.deviceId} is not supported by this MCP.`);
        }

        await controller.shutdown();
        Object.assign(config, inspected.target);
        const activeInfo = inspectRemoteLink(remote_url).publicInfo;
        const result = {
          ...activeInfo,
          matches_active_target: true,
          active: true as const,
          live_control: config.liveControl,
          requires_rearm: true as const,
        };
        return textResult(
          `Active device switched to ${inspected.profile.nameZh}; control must be armed again.`,
          result,
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_device_capabilities",
    {
      title: "Get active Kisstoy capabilities",
      description: "Read the active device model and semantic channel mapping, including webpage labels. This never moves the device.",
      inputSchema: {},
      outputSchema: {
        id: z.number(),
        code: z.string(),
        name: z.string(),
        local_name: z.object({ zh: z.string().optional(), en: z.string().optional() }),
        motors: z.array(
          z.object({
            type: z.number(),
            name: z.string(),
            protocol_name: z.string(),
            semantic_name_zh: z.string().optional(),
            page_label_zh: z.string().optional(),
            position: z.enum(["top", "bottom"]).optional(),
            mcp_tool: z.string().optional(),
            aliases_zh: z.array(z.string()).optional(),
            start_up: z.number().optional(),
          }),
        ),
        support_heating: z.boolean(),
        support_lighting: z.boolean(),
        safety_limits: z.object({ max_intensity: z.number(), max_duration_ms: z.number() }),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const capabilities = await client.getCapabilities();
        const result = {
          id: capabilities.id,
          code: capabilities.code,
          name: capabilities.name,
          local_name: capabilities.localName,
          motors: capabilities.motors.map((motor) => {
            const channel = getMotorChannelProfile(config.deviceId, motor.type);
            return {
              type: motor.type,
              name: channel?.semanticKey ?? motor.name,
              protocol_name: motor.name,
              ...(channel
                ? {
                    semantic_name_zh: channel.semanticNameZh,
                    page_label_zh: channel.pageLabelZh,
                    position: channel.position,
                    mcp_tool: channel.mcpTool,
                    aliases_zh: channel.aliasesZh,
                  }
                : {}),
              ...(motor.startUp === undefined ? {} : { start_up: motor.startUp }),
            };
          }),
          support_heating: capabilities.supportHeating,
          support_lighting: capabilities.supportLighting,
          safety_limits: {
            max_intensity: config.maxIntensity,
            max_duration_ms: config.maxDurationMs,
          },
        };
        return textResult(`Found ${result.motors.length} supported motor channels.`, result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "arm_control",
    {
      title: "Arm physical control",
      description:
        "Start an authorized control session. Call only after the user explicitly confirms they are an adult and the current wearer explicitly consents to this session. This does not move the device.",
      inputSchema: {
        adult_confirmed: z.literal(true).describe("True only after the user explicitly confirms they are an adult."),
        wearer_consent_confirmed: z
          .literal(true)
          .describe("True only after the current device wearer explicitly consents to this control session."),
        ttl_seconds: z.number().int().min(15).max(config.armTtlSeconds).optional(),
      },
      outputSchema: {
        armed: z.literal(true),
        control_token: z.string(),
        expires_at: z.string(),
        live_control: z.boolean(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ adult_confirmed, wearer_consent_confirmed, ttl_seconds }) => {
      try {
        const armed = controller.guard.arm(adult_confirmed, wearer_consent_confirmed, ttl_seconds);
        const result = {
          armed: true as const,
          control_token: armed.token,
          expires_at: armed.expiresAt,
          live_control: config.liveControl,
        };
        return textResult(
          `Control armed until ${armed.expiresAt} in ${config.liveControl ? "live" : "dry-run"} mode.`,
          result,
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  const registerMotorTool = (
    name: "set_secondary_thrust" | "set_suction" | "set_thrust",
    type: 1 | 3 | 4,
  ) => {
    const label =
      type === 1 ? "secondary thrust / 二次抽插" : type === 3 ? "suction / 吮吸" : "thrust / 抽插";
    const title =
      type === 1
        ? "Set secondary thrust / 二次抽插"
        : type === 3
          ? "Set suction / 吮吸"
          : "Set thrust / 抽插";
    const channelGuidance =
      type === 1
        ? "Only supported by 突突二代 (device 18). It controls the TOP channel: webpage 震动 means physical 二次抽插. "
        : type === 3
          ? "Only supported by Cathy III (device 17). It controls the TOP channel labeled 吮吸. "
          : "Supported by both 突突二代 and Cathy III. It controls the BOTTOM channel labeled 抽插. ";
    server.registerTool(
      name,
      {
        title,
        description:
          channelGuidance +
          `Set ${label} intensity for a bounded duration, then automatically stop that motor. ` +
          "This physically actuates the device in live mode and requires an active control-session token; do not request repeated confirmation while that session remains armed.",
        inputSchema: {
          control_token: z.string().min(20),
          intensity: z.number().int().min(0).max(config.maxIntensity),
          duration_ms: z.number().int().min(500).max(config.maxDurationMs),
        },
        outputSchema: {
          mode: z.enum(["live", "dry-run"]),
          motor: z.enum(["vibration", "secondary_thrust", "suction", "thrust"]),
          requested_intensity: z.number(),
          applied_intensity: z.number(),
          duration_ms: z.number(),
          auto_stop_scheduled: z.boolean(),
        },
        annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
      },
      async ({ control_token, intensity, duration_ms }) => {
        try {
          const channel = getMotorChannelProfile(config.deviceId, type);
          if (!channel || channel.mcpTool !== name) {
            throw new Error(
              `${activeDeviceProfile()?.nameZh ?? `device ${config.deviceId}`} does not support ${name}. ` +
                `Use one of: ${describeChannels(config.deviceId)
                  .map((item) => item.mcp_tool)
                  .join(", ")}.`,
            );
          }
          const command = await controller.setMotor(control_token, type, intensity, duration_ms);
          const result = {
            mode: command.mode,
            motor: command.motor,
            requested_intensity: command.requestedIntensity,
            applied_intensity: command.appliedIntensity,
            duration_ms: command.durationMs,
            auto_stop_scheduled: command.autoStopScheduled,
          };
          return textResult(
            `${label} set to ${command.appliedIntensity} for ${command.durationMs} ms (${command.mode}).`,
            result,
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );
  };

  registerMotorTool("set_secondary_thrust", 1);
  registerMotorTool("set_suction", 3);
  registerMotorTool("set_thrust", 4);

  server.registerTool(
    "stop_all",
    {
      title: "Emergency stop",
      description:
        "Immediately set all supported motors to zero and cancel local auto-stop timers. This emergency action never requires a control token.",
      inputSchema: {},
      outputSchema: { mode: z.enum(["live", "dry-run"]), stopped: z.literal(true) },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await controller.stopAll();
        return textResult(`All motors stopped (${result.mode}).`, result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "disarm_control",
    {
      title: "Disarm physical control",
      description: "Stop all motors and invalidate the active control token.",
      inputSchema: { control_token: z.string().min(20) },
      outputSchema: { disarmed: z.literal(true) },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async ({ control_token }) => {
      try {
        await controller.disarm(control_token);
        const result = { disarmed: true as const };
        return textResult("Control session disarmed and all motors stopped.", result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
