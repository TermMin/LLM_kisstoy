import { createHash } from "node:crypto";

const DEFAULT_ORIGIN = "https://api.app.knightjenay.cn";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface KisstoyConfig {
  apiOrigin: string;
  websocketUrl: string;
  group: string;
  deviceId: string;
  bindingId?: string;
  liveControl: boolean;
  maxIntensity: number;
  maxDurationMs: number;
  armTtlSeconds: number;
  maxCommandsPerMinute: number;
  mcpHost: string;
  mcpPort: number;
  mcpBearerToken?: string;
  allowedHosts?: string[];
}

export interface KisstoyRemoteTarget {
  apiOrigin: string;
  websocketUrl: string;
  group: string;
  deviceId: string;
  bindingId?: string;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required. Set KISSTOY_REMOTE_URL or the individual KISSTOY_* values.`);
  }
  return value.trim();
}

function integerInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseBoolean(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Expected "true" or "false", received "${raw}".`);
}

function parseRemoteUrl(raw: string): {
  origin: string;
  group?: string;
  deviceId?: string;
  bindingId?: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("KISSTOY_REMOTE_URL must be a valid absolute URL.");
  }

  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const queryStart = hash.indexOf("?");
  const params = new URLSearchParams(queryStart >= 0 ? hash.slice(queryStart + 1) : "");

  return {
    origin: url.origin,
    group: params.get("group") ?? undefined,
    deviceId: params.get("device_id") ?? undefined,
    bindingId: params.get("id") ?? undefined,
  };
}

export function parseKisstoyRemoteTarget(raw: string): KisstoyRemoteTarget {
  const parsed = parseRemoteUrl(raw);
  const apiOrigin = parsed.origin.replace(/\/$/, "");
  if (apiOrigin !== DEFAULT_ORIGIN) {
    throw new Error(`Refusing unexpected Kisstoy origin "${apiOrigin}".`);
  }

  const group = required(parsed.group, "KISSTOY_GROUP");
  const deviceId = required(parsed.deviceId, "KISSTOY_DEVICE_ID");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(group)) {
    throw new Error("KISSTOY_GROUP has an unexpected format.");
  }
  if (!/^\d{1,10}$/.test(deviceId)) {
    throw new Error("KISSTOY_DEVICE_ID must contain only digits.");
  }
  if (parsed.bindingId && !/^\d{1,20}$/.test(parsed.bindingId)) {
    throw new Error("KISSTOY_BINDING_ID must contain only digits.");
  }

  return {
    apiOrigin,
    websocketUrl: `${apiOrigin.replace(/^http/, "ws")}/websocket-kisstoy`,
    group,
    deviceId,
    bindingId: parsed.bindingId,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KisstoyConfig {
  const parsed = env.KISSTOY_REMOTE_URL ? parseRemoteUrl(env.KISSTOY_REMOTE_URL) : undefined;
  const customOriginAllowed = parseBoolean(env.KISSTOY_ALLOW_CUSTOM_ORIGIN, false);
  const apiOrigin = (env.KISSTOY_API_ORIGIN ?? parsed?.origin ?? DEFAULT_ORIGIN).replace(/\/$/, "");

  if (!customOriginAllowed && apiOrigin !== DEFAULT_ORIGIN) {
    throw new Error(
      `Refusing unexpected Kisstoy origin "${apiOrigin}". ` +
        "Set KISSTOY_ALLOW_CUSTOM_ORIGIN=true only for an origin you control.",
    );
  }
  if (!apiOrigin.startsWith("https://")) {
    throw new Error("KISSTOY_API_ORIGIN must use HTTPS.");
  }

  const group = required(env.KISSTOY_GROUP ?? parsed?.group, "KISSTOY_GROUP");
  const deviceId = required(env.KISSTOY_DEVICE_ID ?? parsed?.deviceId, "KISSTOY_DEVICE_ID");
  const bindingId = env.KISSTOY_BINDING_ID ?? parsed?.bindingId;

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(group)) {
    throw new Error("KISSTOY_GROUP has an unexpected format.");
  }
  if (!/^\d{1,10}$/.test(deviceId)) {
    throw new Error("KISSTOY_DEVICE_ID must contain only digits.");
  }
  if (bindingId && !/^\d{1,20}$/.test(bindingId)) {
    throw new Error("KISSTOY_BINDING_ID must contain only digits.");
  }

  const liveControl = parseBoolean(env.KISSTOY_LIVE_CONTROL, false);
  const maxIntensity = integerInRange(env.KISSTOY_MAX_INTENSITY, 100, 5, 100, "KISSTOY_MAX_INTENSITY");
  if (maxIntensity % 5 !== 0) {
    throw new Error("KISSTOY_MAX_INTENSITY must be a multiple of 5.");
  }

  const mcpHost = env.MCP_HOST?.trim() || "127.0.0.1";
  const mcpBearerToken = env.MCP_BEARER_TOKEN?.trim() || undefined;
  if (mcpBearerToken && mcpBearerToken.length < 24) {
    throw new Error("MCP_BEARER_TOKEN must contain at least 24 characters.");
  }
  if (liveControl && !LOOPBACK_HOSTS.has(mcpHost) && !mcpBearerToken) {
    throw new Error("MCP_BEARER_TOKEN is required for live control on a non-loopback interface.");
  }

  const allowedHosts = env.MCP_ALLOWED_HOSTS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    apiOrigin,
    websocketUrl: `${apiOrigin.replace(/^http/, "ws")}/websocket-kisstoy`,
    group,
    deviceId,
    bindingId,
    liveControl,
    maxIntensity,
    maxDurationMs: integerInRange(
      env.KISSTOY_MAX_DURATION_MS,
      300_000,
      1_000,
      300_000,
      "KISSTOY_MAX_DURATION_MS",
    ),
    armTtlSeconds: integerInRange(
      env.KISSTOY_ARM_TTL_SECONDS,
      3_600,
      15,
      28_800,
      "KISSTOY_ARM_TTL_SECONDS",
    ),
    maxCommandsPerMinute: integerInRange(
      env.KISSTOY_MAX_COMMANDS_PER_MINUTE,
      20,
      1,
      120,
      "KISSTOY_MAX_COMMANDS_PER_MINUTE",
    ),
    mcpHost,
    mcpPort: integerInRange(env.MCP_PORT, 3000, 1, 65_535, "MCP_PORT"),
    mcpBearerToken,
    allowedHosts: allowedHosts?.length ? allowedHosts : undefined,
  };
}

export function publicConfig(config: KisstoyConfig) {
  return {
    device_id: config.deviceId,
    session_fingerprint: createHash("sha256").update(config.group).digest("hex").slice(0, 10),
    live_control: config.liveControl,
    max_intensity: config.maxIntensity,
    max_duration_ms: config.maxDurationMs,
  };
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
