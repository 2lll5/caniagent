import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const TOOL_NAME = "caniagent_echo";

export function handleMcpMessage(message, onToolCall = () => {}) {
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
    const name = message.params?.name;
    const args = message.params?.arguments;
    // Match the advertised inputSchema, including additionalProperties: false.
    const validArguments = args !== null && typeof args === "object" && !Array.isArray(args)
      && Object.keys(args).length === 1 && typeof args.text === "string";
    const text = validArguments ? args.text : null;
    // Count rejected attempts too: a bad call followed by a valid one is not "exactly once".
    // Never persist caller-provided tool names or arguments in the receipt.
    onToolCall({ name: name === TOOL_NAME ? TOOL_NAME : null, text });
    if (name !== TOOL_NAME) return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
    if (!validArguments) return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "arguments must contain only string text" } };
    return { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }], isError: false } };
  }
  if (message.id !== undefined) return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
  return null;
}

function main() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const response = handleMcpMessage(message, ({ name, text }) => {
        const receiptPath = process.env.CANIAGENT_MCP_RECEIPT_PATH;
        if (receiptPath) fs.appendFileSync(receiptPath, JSON.stringify({
          name, matched: name === TOOL_NAME && text === process.env.CANIAGENT_MCP_EXPECTED_TEXT
        }) + "\n", { mode: 0o600 });
      });
      // A missing tool-call receipt only proves zero calls after an actual MCP handshake.
      // If initialization never occurred, the probe must remain inconclusive.
      if (message?.method === "initialize" && response?.result?.capabilities?.tools
        && process.env.CANIAGENT_MCP_INITIALIZED_PATH) {
        fs.writeFileSync(process.env.CANIAGENT_MCP_INITIALIZED_PATH, "initialized\n", { mode: 0o600 });
      }
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
