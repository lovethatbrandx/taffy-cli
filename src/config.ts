import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ConfigSchema, type Config } from "./types.js";

/**
 * Returns the taffy config directory following XDG conventions.
 * Falls back to ~/.config/taffy if XDG_CONFIG_HOME is unset.
 */
export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), ".config");
  return join(base, "taffy");
}

/**
 * Returns the default config file path.
 */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/**
 * Builds a Config from raw JSON, applying env-var overrides and Zod defaults.
 * Env vars take precedence over file values:
 *   TAFFY_API_KEY, TAFFY_MODEL, TAFFY_BASE_URL, TAFFY_PROVIDER_TYPE
 */
function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };

  if (process.env.TAFFY_API_KEY) out.apiKey = process.env.TAFFY_API_KEY;
  if (process.env.TAFFY_MODEL) out.model = process.env.TAFFY_MODEL;
  if (process.env.TAFFY_BASE_URL) out.baseURL = process.env.TAFFY_BASE_URL;
  if (process.env.TAFFY_PROVIDER_TYPE) out.type = process.env.TAFFY_PROVIDER_TYPE;
  if (process.env.TAFFY_CLIPBOARD) out.clipboard = process.env.TAFFY_CLIPBOARD === "true";

  return out;
}

/**
 * Loads config from disk, applies env overrides, validates with Zod.
 * Creates default config if missing.
 */
export function loadConfig(): Config {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    const defaults = ConfigSchema.parse({});
    writeFileSync(configPath, JSON.stringify(defaults, null, 2) + "\n", "utf-8");
    return defaults;
  }

  let raw: Record<string, unknown>;
  try {
    const content = readFileSync(configPath, "utf-8");
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(`[taffy] Failed to parse config at ${configPath}: ${String(err)}\n`);
    process.stderr.write("[taffy] Falling back to defaults.\n");
    return ConfigSchema.parse({});
  }

  const merged = applyEnvOverrides(raw);

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    process.stderr.write(`[taffy] Invalid config at ${configPath}:\n`);
    for (const issue of result.error.issues) {
      process.stderr.write(`  - ${issue.path.join(".")}: ${issue.message}\n`);
    }
    process.stderr.write("[taffy] Falling back to defaults.\n");
    return ConfigSchema.parse({});
  }

  return result.data;
}

/**
 * Saves a config to disk.
 */
export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
