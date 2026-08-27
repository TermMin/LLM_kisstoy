import { randomBytes, timingSafeEqual } from "node:crypto";

export interface ArmResult {
  token: string;
  expiresAt: string;
}

export class ControlGuard {
  private token?: string;
  private expiresAt = 0;
  private commandTimestamps: number[] = [];

  constructor(
    private readonly defaultTtlSeconds: number,
    private readonly maxCommandsPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  arm(adultConfirmed: boolean, wearerConsentConfirmed: boolean, ttlSeconds?: number): ArmResult {
    if (!adultConfirmed || !wearerConsentConfirmed) {
      throw new Error("Adult status and the current wearer's explicit consent must both be confirmed.");
    }

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    if (!Number.isInteger(ttl) || ttl < 15 || ttl > this.defaultTtlSeconds) {
      throw new Error(`ttl_seconds must be between 15 and ${this.defaultTtlSeconds}.`);
    }

    this.token = randomBytes(24).toString("base64url");
    this.expiresAt = this.now() + ttl * 1_000;
    this.commandTimestamps = [];
    return { token: this.token, expiresAt: new Date(this.expiresAt).toISOString() };
  }

  validate(candidate: string): void {
    if (!this.token || this.now() >= this.expiresAt) {
      this.disarm();
      throw new Error("Control session is not armed or has expired. Call arm_control again after explicit consent.");
    }

    const expected = Buffer.from(this.token);
    const received = Buffer.from(candidate);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error("Invalid control session token.");
    }
  }

  consumeCommand(candidate: string): void {
    this.validate(candidate);
    const cutoff = this.now() - 60_000;
    this.commandTimestamps = this.commandTimestamps.filter((timestamp) => timestamp > cutoff);
    if (this.commandTimestamps.length >= this.maxCommandsPerMinute) {
      throw new Error("Control rate limit reached. Wait before sending another command.");
    }
    this.commandTimestamps.push(this.now());
  }

  disarm(): void {
    this.token = undefined;
    this.expiresAt = 0;
    this.commandTimestamps = [];
  }

  status(): { armed: boolean; expiresAt?: string } {
    if (!this.token || this.now() >= this.expiresAt) {
      this.disarm();
      return { armed: false };
    }
    return { armed: true, expiresAt: new Date(this.expiresAt).toISOString() };
  }
}
