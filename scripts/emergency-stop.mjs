import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.KISSTOY_LOCAL_MCP_URL ?? "http://127.0.0.1:3000/mcp";
const client = new Client({ name: "kisstoy-emergency-stop", version: "1.0.0" });

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const result = await client.callTool({ name: "stop_all", arguments: {} });
  if (result.isError) throw new Error("stop_all returned an error");
  process.stdout.write("Emergency stop confirmed.\n");
} finally {
  await client.close().catch(() => undefined);
}
