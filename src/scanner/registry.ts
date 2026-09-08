import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AppEntry, AppRegistry, Config } from "../types.js";
import { getConfigDir } from "../config.js";

/** Bump this to force a full re-scan on upgrade. */
export const SCAN_VERSION = 1;

function getRegistryPath(): string {
  return join(getConfigDir(), "registry.json");
}

/**
 * Load the cached registry from disk.
 * Returns null if missing, corrupt, or from a different scan version.
 */
export async function loadRegistry(): Promise<AppRegistry | null> {
  const registryPath = getRegistryPath();

  if (!existsSync(registryPath)) return null;

  try {
    const raw = readFileSync(registryPath, "utf-8");
    const data = JSON.parse(raw) as AppRegistry;

    // Basic shape validation
    if (!Array.isArray(data.apps) || typeof data.scannedAt !== "number") {
      return null;
    }

    // Reject if scan version changed
    if (data.scanVersion !== SCAN_VERSION) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Persist the registry to disk.
 */
export async function saveRegistry(registry: AppRegistry): Promise<void> {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const registryPath = getRegistryPath();
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

/**
 * Return cached registry if valid, otherwise run the scan function.
 */
export async function getOrRescan(
  config: Config,
  scanFn: () => Promise<AppRegistry>,
): Promise<AppRegistry> {
  const cached = await loadRegistry();

  if (cached) {
    const age = Date.now() - cached.scannedAt;
    if (age < config.scanner.cacheMaxAgeMs) {
      return cached;
    }
  }

  return scanFn();
}

/**
 * Fuzzy-ish search across app name, description, categories, keywords, and exec.
 * Returns matches sorted by relevance (name match > keyword > category > description).
 */
export function searchApps(registry: AppRegistry, query: string): AppEntry[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) return registry.apps;

  interface ScoredEntry {
    app: AppEntry;
    score: number;
  }

  const scored: ScoredEntry[] = [];

  for (const app of registry.apps) {
    let score = 0;
    const nameLower = app.name.toLowerCase();
    const execLower = app.exec.toLowerCase();
    const descLower = app.description.toLowerCase();
    const keywordsLower = app.keywords.map((k) => k.toLowerCase());
    const categoriesLower = app.categories.map((c) => c.toLowerCase());

    for (const term of terms) {
      // Exact name match: highest priority
      if (nameLower === term) {
        score += 100;
      }
      // Name starts with term
      else if (nameLower.startsWith(term)) {
        score += 80;
      }
      // Name contains term
      else if (nameLower.includes(term)) {
        score += 60;
      }
      // Exec basename contains term
      else if (execLower.includes(term)) {
        score += 40;
      }
      // Keyword match
      else if (keywordsLower.some((k) => k.includes(term))) {
        score += 50;
      }
      // Category match
      else if (categoriesLower.some((c) => c.includes(term))) {
        score += 30;
      }
      // Description contains term
      else if (descLower.includes(term)) {
        score += 20;
      }
    }

    if (score > 0) {
      scored.push({ app, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.app);
}
