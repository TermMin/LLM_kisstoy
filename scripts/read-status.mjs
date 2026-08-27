import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.KISSTOY_LOCAL_MCP_URL ?? "http://127.0.0.1:3000/mcp";
const client = new Client({ name: "kisstoy-status", version: "1.0.0" });

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const result = await client.callTool({ name: "get_device_status", arguments: {} });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? "status query failed");
  process.stdout.write(`${JSON.stringify(result.structuredContent, null, 2)}\n`);
} finally {
  await client.close().catch(() => undefined);
}
