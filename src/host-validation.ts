import type { NextFunction, Request, Response } from "express";

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

export function hostnameMatchesPattern(hostname: string, pattern: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const normalizedPattern = pattern.toLowerCase().trim().replace(/\.$/, "");
  if (!normalizedPattern) return false;
  if (!normalizedPattern.startsWith("*.")) return normalizedHostname === normalizedPattern;

  const suffix = normalizedPattern.slice(1);
  return normalizedHostname.endsWith(suffix) && normalizedHostname.length > suffix.length;
}

export function allowedHostPatterns(configured?: readonly string[]): string[] {
  return [...new Set([...LOOPBACK_HOSTNAMES, ...(configured ?? [])].map((value) => value.toLowerCase()))];
}

export function isAllowedHostHeader(hostHeader: string | undefined, configured?: readonly string[]): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return allowedHostPatterns(configured).some((pattern) => hostnameMatchesPattern(hostname, pattern));
}

export function hostValidation(configured?: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAllowedHostHeader(req.headers.host, configured)) {
      next();
      return;
    }
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or disallowed Host header" },
      id: null,
    });
  };
}
