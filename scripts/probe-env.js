import path from "node:path";

// Keep behavior-probe configuration in its temporary home, not the caller's.
// Unrelated environment variables (including authentication) are preserved.
export function isolatedProbeEnvironment(home, inherited = process.env) {
  // Inherited Node preloads can execute before a probe's agent CLI starts.
  // Windows environment keys are case-insensitive: remove aliases of every
  // overridden path as well as NODE_OPTIONS before adding isolated values.
  const isolatedKeys = new Set([
    "HOME", "USERPROFILE", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
    "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "XDG_STATE_HOME", "XDG_CACHE_HOME", "NODE_OPTIONS"
  ]);
  const safeInherited = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !isolatedKeys.has(key.toUpperCase()))
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
