import type { AppEntry, AppRegistry, Config } from "../types.js";
import { scanXDG, scanSnap, scanFlatpak, scanPath } from "./sources.js";
import { saveRegistry, SCAN_VERSION } from "./registry.js";

// Standard XDG application directories
const XDG_APPLICATION_DIRS = [
  "/usr/share/applications",
  "/usr/local/share/applications",
];

/**
 * Deduplicate apps by exec path (lowercase basename).
 * First occurrence wins — XDG > snap > flatpak > path.
 */
function deduplicateApps(apps: AppEntry[]): AppEntry[] {
  const seen = new Set<string>();
  const result: AppEntry[] = [];

  for (const app of apps) {
    // Use the first token of exec (the actual binary) as dedup key
    const execBinary = app.exec.split(" ")[0].toLowerCase();
    const key = execBinary;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(app);
  }

  return result;
}

/**
 * Scan all enabled sources and merge results.
 */
export async function scanApplications(config: Config): Promise<AppEntry[]> {
  const sources = config.scanner.sources;
  const promises: Promise<AppEntry[]>[] = [];

  if (sources.xdgApplications) {
    promises.push(scanXDG(XDG_APPLICATION_DIRS));
  }
  if (sources.snap) {
    promises.push(scanSnap());
  }
  if (sources.flatpak) {
    promises.push(scanFlatpak());
  }
  if (sources.pathBinaries) {
    promises.push(scanPath());
  }

  const results = await Promise.allSettled(promises);
  const allApps: AppEntry[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allApps.push(...result.value);
    } else {
      process.stderr.write(
        `[taffy] Scanner source failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`,
      );
    }
  }

  return deduplicateApps(allApps);
}

/**
 * Full scan: scan all sources, build registry, save to disk, return it.
 */
export async function fullScan(config: Config): Promise<AppRegistry> {
  process.stderr.write("[taffy] Scanning applications...\n");

  const apps = await scanApplications(config);

  const registry: AppRegistry = {
    apps,
    scannedAt: Date.now(),
    scanVersion: SCAN_VERSION,
  };

  await saveRegistry(registry);

  process.stderr.write(`[taffy] Found ${apps.length} applications.\n`);

  return registry;
}
