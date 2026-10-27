import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const TOOL_NAME = "caniagent_echo";
// This fixture implements the 2025-06-18 legacy MCP handshake, not arbitrary revisions.
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export function handleMcpMessage(message, onToolCall = () => {}) {
  // JSON-RPC requires a request object; valid JSON primitives and arrays are not requests.
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (message.method === "initialize") {
    const params = message.params;
    // Only a valid JSON-RPC MCP initialize request can establish handshake evidence.
    const valid = message.jsonrpc === "2.0"
      && (typeof message.id === "string" || (typeof message.id === "number" && Number.isFinite(message.id)))
      && params && typeof params === "object" && !Array.isArray(params)
      && typeof params.protocolVersion === "string" && params.protocolVersion.length > 0
      && params.capabilities && typeof params.capabilities === "object" && !Array.isArray(params.capabilities)
      && params.clientInfo && typeof params.clientInfo === "object" && !Array.isArray(params.clientInfo)
      && typeof params.clientInfo.name === "string" && params.clientInfo.name.length > 0
      && typeof params.clientInfo.version === "string" && params.clientInfo.version.length > 0;
    if (!valid) return { jsonrpc: "2.0", id: message.id ?? null,
      error: { code: -32600, message: "Invalid initialize request" } };
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        // Legacy MCP version negotiation must advertise a revision this server actually supports.
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "caniagent-echo", version: "1.0.0" }
      }
    };
  }
  if (message.method === "tools/list") {
    const validRequest = message.jsonrpc === "2.0"
      && (typeof message.id === "string" || (typeof message.id === "number" && Number.isFinite(message.id)));
    if (!validRequest) return { jsonrpc: "2.0", id: null,
      error: { code: -32600, message: "Invalid tools/list request" } };
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
    // A tools/call must be a JSON-RPC request, not a notification or malformed envelope.
    const validRequest = message.jsonrpc === "2.0"
      && (typeof message.id === "string" || (typeof message.id === "number" && Number.isFinite(message.id)));
    const name = message.params?.name;
    const args = message.params?.arguments;
    // Match the advertised inputSchema, including additionalProperties: false.
    const validArguments = args !== null && typeof args === "object" && !Array.isArray(args)
      && Object.keys(args).length === 1 && typeof args.text === "string";
    const text = validArguments ? args.text : null;
    // Count rejected attempts too: a bad call followed by a valid one is not "exactly once".
    // The process records calls made before initialize as unmatched.
    // Never persist caller-provided tool names or arguments in the receipt.
    onToolCall({ name: validRequest && name === TOOL_NAME ? TOOL_NAME : null, text: validRequest ? text : null });
    if (!validRequest) return { jsonrpc: "2.0", id: null,
      error: { code: -32600, message: "Invalid tools/call request" } };
    if (name !== TOOL_NAME) return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } };
    if (!validArguments) return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "arguments must contain only string text" } };
    return { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }], isError: false } };
  }
  if (message.id !== undefined) return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
  return null;
}

function main() {
  let initializeResponded = false;
  let initialized = false;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    let response = handleMcpMessage(message, ({ name, text }) => {
      const receiptPath = process.env.CANIAGENT_MCP_RECEIPT_PATH;
      if (receiptPath) fs.appendFileSync(receiptPath, JSON.stringify({
        name, matched: initialized && name === TOOL_NAME && text === process.env.CANIAGENT_MCP_EXPECTED_TEXT
      }) + "\n", { mode: 0o600 });
    });
    // Legacy MCP tool discovery is also a post-initialization request.
    // Do not serve tools/list after initialize alone, before notifications/initialized.
    if (message?.method === "tools/list" && !initialized && response?.result) {
      response = { jsonrpc: "2.0", id: message.id,
        error: { code: -32000, message: "Server not initialized" } };
    }
    // Keep the rejected attempt in the receipt, but never return a successful tool
    // result before the client completes the MCP initialization notification.
    if (message?.method === "tools/call" && !initialized && response?.result) {
      response = { jsonrpc: "2.0", id: message.id,
        error: { code: -32000, message: "Server not initialized" } };
    }
    // A missing tool-call receipt only proves zero calls after an actual MCP handshake.
    // If initialization never occurred, the probe must remain inconclusive.
    if (message?.method === "initialize" && response?.result?.capabilities?.tools) {
      initializeResponded = true;
    }
    // A valid initialize response alone does not complete the MCP handshake.
    // The client must also send a valid notifications/initialized notification.
    // MCP notifications may omit params, but supplied params (and _meta) must be objects.
    // Do not treat a malformed notification as proof that the client finished initialization.
    const notificationParams = message?.params;
    const validNotificationParams = notificationParams === undefined
      || (notificationParams !== null && typeof notificationParams === "object"
        && !Array.isArray(notificationParams)
        && (notificationParams._meta === undefined
          || (notificationParams._meta !== null && typeof notificationParams._meta === "object"
            && !Array.isArray(notificationParams._meta))));
    if (message?.method === "notifications/initialized"
      && message.jsonrpc === "2.0" && message.id === undefined
      && validNotificationParams && initializeResponded && !initialized) {
      // Create a zero-call receipt before publishing successful handshake evidence.
      // If this fails, the server must not advertise a trustworthy initialized state.
      if (process.env.CANIAGENT_MCP_RECEIPT_PATH) {
        fs.closeSync(fs.openSync(process.env.CANIAGENT_MCP_RECEIPT_PATH, "a", 0o600));
      }
      initialized = true;
      if (process.env.CANIAGENT_MCP_INITIALIZED_PATH) {
        fs.writeFileSync(process.env.CANIAGENT_MCP_INITIALIZED_PATH, "initialized\n", { mode: 0o600 });
      }
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
