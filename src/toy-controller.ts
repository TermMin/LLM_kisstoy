import type { KisstoyConfig } from "./config.js";
import { ControlGuard } from "./control-guard.js";
import { getMotorChannelProfile } from "./device-profile.js";
import type { MotorType, ToyClientPort } from "./kisstoy-client.js";

export interface MotorCommandResult {
  mode: "live" | "dry-run";
  motor: "vibration" | "secondary_thrust" | "suction" | "thrust";
  requestedIntensity: number;
  appliedIntensity: number;
  durationMs: number;
  autoStopScheduled: boolean;
}

export class ToyController {
  readonly guard: ControlGuard;
  private readonly stopTimers = new Map<MotorType, NodeJS.Timeout>();

  constructor(
    private readonly config: KisstoyConfig,
    private readonly client: ToyClientPort,
  ) {
    this.guard = new ControlGuard(config.armTtlSeconds, config.maxCommandsPerMinute);
  }

  async setMotor(
    token: string,
    type: MotorType,
    requestedIntensity: number,
    durationMs: number,
  ): Promise<MotorCommandResult> {
    this.guard.consumeCommand(token);
    if (!Number.isInteger(requestedIntensity) || requestedIntensity < 0 || requestedIntensity > 100) {
      throw new Error("intensity must be an integer between 0 and 100.");
    }
    if (requestedIntensity > this.config.maxIntensity) {
      throw new Error(`intensity exceeds the configured maximum of ${this.config.maxIntensity}.`);
    }
    if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > this.config.maxDurationMs) {
      throw new Error(`duration_ms must be between 500 and ${this.config.maxDurationMs}.`);
    }

    const intensity = Math.floor(requestedIntensity / 5) * 5;
    const existing = this.stopTimers.get(type);
    if (existing) clearTimeout(existing);
    this.stopTimers.delete(type);

    if (this.config.liveControl) {
      const online = await this.client.getOnlineStatus();
      if (!online) throw new Error("The device is offline; no control command was sent.");
      await this.client.setMotor(type, intensity);
    }

    if (intensity > 0) {
      const timer = setTimeout(() => {
        this.stopTimers.delete(type);
        if (this.config.liveControl) {
          void this.client.setMotor(type, 0).catch(() => {
            console.error(`[safety] Failed to auto-stop motor ${type}; use stop_all immediately.`);
          });
        }
      }, durationMs);
      timer.unref();
      this.stopTimers.set(type, timer);
    }

    return {
      mode: this.config.liveControl ? "live" : "dry-run",
      motor:
        getMotorChannelProfile(this.config.deviceId, type)?.semanticKey ??
        (type === 1 ? "vibration" : "thrust"),
      requestedIntensity,
      appliedIntensity: intensity,
      durationMs,
      autoStopScheduled: intensity > 0,
    };
  }

  async stopAll(): Promise<{ mode: "live" | "dry-run"; stopped: true }> {
    for (const timer of this.stopTimers.values()) clearTimeout(timer);
    this.stopTimers.clear();
    if (this.config.liveControl) await this.client.stopAll();
    return { mode: this.config.liveControl ? "live" : "dry-run", stopped: true };
  }

  async disarm(token: string): Promise<void> {
    this.guard.validate(token);
    await this.stopAll();
    this.guard.disarm();
  }

  async shutdown(): Promise<void> {
    try {
      await this.stopAll();
    } finally {
      this.guard.disarm();
      await this.client.close();
    }
  }
}
