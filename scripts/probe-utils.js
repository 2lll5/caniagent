import os from "node:os";

const SECRET_PATTERNS = [
  /(sk-[A-Za-z0-9_-]{12,})\b/g,
  /(gh[pousr]_[A-Za-z0-9_]{12,})\b/g,
  /(github_pat_[A-Za-z0-9_]{12,})\b/g,
  /(npm_[A-Za-z0-9]{12,})\b/g,
  /(AIza[0-9A-Za-z_-]{20,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
  /\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
  /\b([A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)(?:_[A-Za-z0-9_]+)*\s*[=:]\s*)[^\s,;]+/gi
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactHomePaths(output, home) {
  if (!home) return output;

  const normalizedHome = home.replaceAll("\\", "/");
  if (/^[A-Za-z]:[\\/]/.test(home)) {
    const windowsHome = escapeRegExp(normalizedHome).replaceAll("/", "[\\\\/]");
    return output.replace(new RegExp(windowsHome, "gi"), "<HOME>");
  }

  output = output.replaceAll(home, "<HOME>");
  if (normalizedHome !== home) output = output.replaceAll(normalizedHome, "<HOME>");
  return output;
}

export function redactProbeOutput(value, { home = os.homedir() } = {}) {
  let output = redactHomePaths(String(value ?? ""), home);

  // Agent diagnostics can echo authenticated registry/proxy URLs. Preserve the
  // destination for debugging while removing both user-info fields.
  output = output.replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<REDACTED>:<REDACTED>@");

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => {
      if (prefix && /(?:Bearer\s+|(?:[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)(?:_[A-Za-z0-9_]+)*|api[_-]?key|token|secret|password)\s*[=:]\s*)$/i.test(prefix)) {
        return `${prefix}<REDACTED>`;
      }
      return "<REDACTED>";
    });
  }

  return output;
}

export function redactAndTruncateProbeOutput(value, { maxLength = 12000, home = os.homedir() } = {}) {
  return redactProbeOutput(value, { home }).slice(0, maxLength);
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
