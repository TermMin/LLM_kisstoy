import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, publicConfig } from "./config.js";
import { startHttpServer } from "./http-server.js";
import { KisstoyClient } from "./kisstoy-client.js";
import { createKisstoyMcpServer } from "./mcp-server.js";
import { ToyController } from "./toy-controller.js";

async function main() {
  const config = loadConfig();
  const client = new KisstoyClient(config);
  const controller = new ToyController(config, client);
  const useStdio = process.argv.includes("--stdio");

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.error(`Shutting down after ${signal}; applying safety stop.`);
    try {
      await controller.shutdown();
    } catch (error) {
      console.error("Safety shutdown failed:", error instanceof Error ? error.message : "unknown error");
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (useStdio) {
    const server = createKisstoyMcpServer(config, client, controller);
    await server.connect(new StdioServerTransport());
    console.error(`kisstoy multi-device MCP running over stdio (${config.liveControl ? "LIVE" : "dry-run"})`);
    return;
  }

  await startHttpServer(config, client, controller);
  const safe = publicConfig(config);
  console.error(
    `kisstoy multi-device MCP listening at http://${config.mcpHost}:${config.mcpPort}/mcp ` +
      `(${config.liveControl ? "LIVE" : "dry-run"}, session ${safe.session_fingerprint})`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
