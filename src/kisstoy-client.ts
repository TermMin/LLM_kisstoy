import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { KisstoyConfig } from "./config.js";
import { getDeviceProfile } from "./device-profile.js";

export type MotorType = 1 | 3 | 4;

export interface DeviceCapabilities {
  id: number;
  code: string;
  name: string;
  localName: { zh?: string; en?: string };
  motors: Array<{ type: number; name: string; startUp?: number }>;
  supportHeating: boolean;
  supportLighting: boolean;
}

export interface ToyClientPort {
  getCapabilities(): Promise<DeviceCapabilities>;
  getOnlineStatus(): Promise<boolean>;
  setMotor(type: MotorType, intensity: number): Promise<void>;
  stopAll(): Promise<void>;
  close(): Promise<void>;
  connectionState(): string;
}

interface WireMessage {
  event?: string;
  result?: string;
  data?: Record<string, unknown> | null;
}

const MOTOR_NAMES: Record<number, string> = {
  1: "vibration",
  2: "vibration_secondary",
  3: "suction",
  4: "thrust",
  5: "electric",
  6: "flap",
};

export class KisstoyClient implements ToyClientPort {
  private socket?: WebSocket;
  private connectPromise?: Promise<void>;
  private heartbeat?: NodeJS.Timeout;
  private readonly events = new EventEmitter();

  constructor(private readonly config: KisstoyConfig) {}

  connectionState(): string {
    switch (this.socket?.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      case WebSocket.CLOSING:
        return "closing";
      default:
        return "disconnected";
    }
  }

  async getCapabilities(): Promise<DeviceCapabilities> {
    const endpoint = new URL("/kisstoy/device/detail", this.config.apiOrigin);
    endpoint.searchParams.set("id", this.config.deviceId);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=utf-8",
        Server: "1",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Device details request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        id?: number;
        code?: string;
        name?: string;
        config?: {
          motors?: Array<{ type?: number; start_up?: number }>;
          local_name?: { zh?: string; en?: string };
          support_heating?: boolean;
          support_lighting?: boolean;
        };
      };
    };

    if (payload.code !== 1 || !payload.data?.config || typeof payload.data.id !== "number") {
      throw new Error(payload.msg || "Device details response was invalid.");
    }

    return {
      id: payload.data.id,
      code: payload.data.code ?? "",
      name: payload.data.name ?? "Unknown device",
      localName: payload.data.config.local_name ?? {},
      motors: (payload.data.config.motors ?? []).flatMap((motor) =>
        typeof motor.type === "number"
          ? [{ type: motor.type, name: MOTOR_NAMES[motor.type] ?? `motor_${motor.type}`, startUp: motor.start_up }]
          : [],
      ),
      supportHeating: payload.data.config.support_heating === true,
      supportLighting: payload.data.config.support_lighting === true,
    };
  }

  async getOnlineStatus(): Promise<boolean> {
    await this.ensureConnected();
    const response = this.waitForEvent("online_status", 6_000);
    this.send({ event: "online_status", data: { group: this.config.group } });
    const message = await response;
    return message.data?.online_status === 1;
  }

  async setMotor(type: MotorType, intensity: number): Promise<void> {
    await this.ensureConnected();
    this.send({
      event: "control",
      data: {
        target: this.config.group,
        device_id: this.config.deviceId,
        motors: { [type]: intensity },
      },
    });
  }

  async stopAll(): Promise<void> {
    await this.ensureConnected();
    const configuredTypes = getDeviceProfile(this.config.deviceId)?.channels.map((channel) => channel.type);
    const motorTypes = configuredTypes?.length ? configuredTypes : [1, 3, 4];
    this.send({
      event: "control",
      data: {
        target: this.config.group,
        device_id: this.config.deviceId,
        motors: Object.fromEntries(motorTypes.map((type) => [type, 0])),
      },
    });
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.connectPromise = undefined;

    const socket = this.socket;
    this.socket = undefined;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1_000);
      socket.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.close();
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const endpoint = new URL(this.config.websocketUrl);
      endpoint.searchParams.set("group", this.config.group);
      const socket = new WebSocket(endpoint);
      this.socket = socket;

      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error("Timed out connecting to the Kisstoy WebSocket service."));
      }, 8_000);

      socket.once("open", () => {
        clearTimeout(timeout);
        this.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) this.send({ event: "ping" });
        }, 10_000);
        this.heartbeat.unref();
        resolve();
      });

      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as WireMessage;
          if (message.event) this.events.emit(message.event, message);
        } catch {
          // Ignore malformed service messages without echoing potentially sensitive data.
        }
      });

      socket.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Kisstoy WebSocket connection failed."));
      });

      socket.once("close", () => {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        this.connectPromise = undefined;
        if (this.socket === socket) this.socket = undefined;
      });
    });

    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = undefined;
      throw error;
    }
  }

  private send(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Kisstoy WebSocket is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  private waitForEvent(event: string, timeoutMs: number): Promise<WireMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.events.off(event, listener);
        reject(new Error(`Timed out waiting for ${event}.`));
      }, timeoutMs);
      const listener = (message: WireMessage) => {
        clearTimeout(timeout);
        resolve(message);
      };
      this.events.once(event, listener);
    });
  }
}
