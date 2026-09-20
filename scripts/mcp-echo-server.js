import readline from "node:readline";

export const TOOL_NAME = "caniagent_echo";

export function handleMcpMessage(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "caniagent-echo", version: "1.0.0" }
      }
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: TOOL_NAME,
          description: "Return the supplied text unchanged for CanIAgent compatibility probing.",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false
          }
        }]
      }
    };
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== TOOL_NAME) {
      return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
    }
    const text = message.params?.arguments?.text;
    if (typeof text !== "string") {
      return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "text must be a string" } };
    }
    return { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }], isError: false } };
  }
  if (message.id !== undefined) {
    return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
  }
  return null;
}

function main() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const response = handleMcpMessage(JSON.parse(line));
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
