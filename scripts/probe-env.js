import path from "node:path";

// Keep behavior-probe configuration in its temporary home, not the caller's.
// Unrelated environment variables (including authentication) are preserved.
export function isolatedProbeEnvironment(home, inherited = process.env) {
  // Inherited Node preloads can execute before a probe's agent CLI starts.
  // Remove case variants as Windows environment keys are case-insensitive.
  const safeInherited = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => key.toUpperCase() !== "NODE_OPTIONS")
  );
  return {
    ...safeInherited,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, ".codex"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache")
  };
}
