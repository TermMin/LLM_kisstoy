import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { KisstoyConfig } from "./config.js";
import { hostValidation } from "./host-validation.js";
import type { ToyClientPort } from "./kisstoy-client.js";
import { createKisstoyMcpServer } from "./mcp-server.js";
import type { ToyController } from "./toy-controller.js";

function bearerAuth(config: KisstoyConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.mcpBearerToken) return next();
    const header = req.header("authorization");
    const received = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const expectedBuffer = Buffer.from(config.mcpBearerToken);
    const receivedBuffer = Buffer.from(received);
    const valid =
      expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
    if (!valid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export async function startHttpServer(
  config: KisstoyConfig,
  client: ToyClientPort,
  controller: ToyController,
): Promise<Server> {
  // The SDK convenience app only supports exact Host matches, so use Express
  // directly and apply our strict exact-or-leading-wildcard matcher.
  const app = express();
  app.use(express.json());
  app.use(hostValidation(config.allowedHosts));
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "kisstoy-multi-device-mcp", mode: config.liveControl ? "live" : "dry-run" });
  });

  app.use("/mcp", bearerAuth(config));
  app.post("/mcp", async (req, res) => {
    const server = createKisstoyMcpServer(config, client, controller);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.mcpPort, config.mcpHost, () => resolve(httpServer));
    httpServer.once("error", reject);
  });
}
