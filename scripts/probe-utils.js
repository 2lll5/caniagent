import os from "node:os";

const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{20,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
  /\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi
];

export function redactProbeOutput(value, { home = os.homedir() } = {}) {
  let output = String(value ?? "");

  if (home) {
    const normalizedHome = home.replaceAll("\\", "/");
    output = output.replaceAll(home, "<HOME>");
    if (normalizedHome !== home) output = output.replaceAll(normalizedHome, "<HOME>");
  }

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => {
      if (prefix && /^(Bearer\s+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*)$/i.test(prefix)) {
        return `${prefix}<REDACTED>`;
      }
      return "<REDACTED>";
    });
  }

  return output;
}

export function classifyProbeExecution(result) {
  if (result?.error) {
    if (result.error.code === "ENOENT") return "not_found";
    if (result.error.code === "ETIMEDOUT") return "timeout";
    return "spawn_error";
  }
  if (result?.signal) return "signaled";
  return result?.status === 0 ? "success" : "nonzero_exit";
}
