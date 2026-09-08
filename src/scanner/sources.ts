import { readdir, readFile, stat, access } from "fs/promises";
import { join, basename } from "path";
import { constants } from "fs";
import type { AppEntry, AppSource } from "../types.js";

// ---------------------------------------------------------------------------
// .desktop file parser
// ---------------------------------------------------------------------------

interface DesktopEntry {
  name: string;
  exec: string;
  comment: string;
  categories: string[];
  keywords: string[];
  noDisplay: boolean;
  onlyShowIn: string;
  type: string;
  terminal: boolean;
}

function parseDesktopFile(content: string): DesktopEntry | null {
  const entry: Record<string, string> = {};
  let inDesktopEntry = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section headers
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDesktopEntry = trimmed === "[Desktop Entry]";
      continue;
    }

    // Only parse key=value inside [Desktop Entry]
    if (!inDesktopEntry) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    entry[key] = value;
  }

  // Must have a Name and either Exec or URL
  const name = entry["Name"];
  if (!name) return null;

  const exec = entry["Exec"] ?? entry["URL"] ?? "";
  if (!exec) return null;

  // Skip NoDisplay=true
  const noDisplay = entry["NoDisplay"]?.toLowerCase() === "true";

  // OnlyShowIn: if set to something non-empty, skip (we don't know the DE)
  const onlyShowIn = entry["OnlyShowIn"] ?? "";

  const comment = entry["Comment"] ?? "";

  // Categories: semicolon-separated, filter empty
  const categories = (entry["Categories"] ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  // Keywords: semicolon-separated, filter empty
  const keywords = (entry["Keywords"] ?? "")
    .split(";")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  const type = entry["Type"] ?? "Application";
  const terminal = entry["Terminal"]?.toLowerCase() === "true";

  return {
    name,
    exec,
    comment,
    categories,
    keywords,
    noDisplay,
    onlyShowIn,
    type,
    terminal,
  };
}

/**
 * Clean an Exec field: remove desktop-entry flags (%u %f %F %U %d %D %n %N %i %c %k)
 * and leading env assignments (e.g. env VAR=val).
 */
function cleanExec(raw: string): string {
  // Remove field codes: standalone %u %f %F %U %d %D %n %N %i %c %k (case-insensitive)
  let cleaned = raw.replace(/%[uFfUdDnNickk]/gi, "").trim();

  // Remove quoted field codes like "%f"
  cleaned = cleaned.replace(/"%[uFfUdDnNickk]"/gi, "").trim();

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  // Strip leading env assignments: env VAR=val ... or VAR=val ...
  // Only strip if it looks like env var assignment (ALL_CAPS=...)
  cleaned = cleaned.replace(/^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=\S+\s+)*/, "").trim();

  return cleaned;
}

// ---------------------------------------------------------------------------
// XDG .desktop file scanning
// ---------------------------------------------------------------------------

const XDG_DEFAULT_DIRS = [
  "/usr/share/applications",
  "/usr/local/share/applications",
];

const XDG_USER_DIR = ".local/share/applications";

async function readDesktopFiles(dir: string): Promise<{ content: string; path: string }[]> {
  let entries: string[];
  try {
    const dirEntries = await readdir(dir);
    entries = dirEntries.filter((e) => e.endsWith(".desktop"));
  } catch {
    return [];
  }

  const results: { content: string; path: string }[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const content = await readFile(fullPath, "utf-8");
      results.push({ content, path: fullPath });
    } catch {
      // Unreadable file, skip
    }
  }

  return results;
}

/**
 * Scan XDG .desktop files from the given directories.
 * Also scans ~/.local/share/applications for user entries.
 */
export async function scanXDG(dirs: string[]): Promise<AppEntry[]> {
  const home = process.env.HOME ?? "/root";
  const userDir = join(home, XDG_USER_DIR);

  // Combine provided dirs with user dir (user dir first for precedence)
  const allDirs = [userDir, ...dirs];

  const apps: AppEntry[] = [];
  const seen = new Set<string>();

  for (const dir of allDirs) {
    const files = await readDesktopFiles(dir);
    const isUser = dir === userDir;

    for (const { content, path } of files) {
      const parsed = parseDesktopFile(content);
      if (!parsed) continue;

      // Skip NoDisplay
      if (parsed.noDisplay) continue;

      // Skip if OnlyShowIn is set (we don't know the desktop environment)
      if (parsed.onlyShowIn.length > 0) continue;

      // Skip if Type is not Application
      if (parsed.type !== "Application") continue;

      const exec = cleanExec(parsed.exec);
      if (!exec) continue;

      // Deduplicate by exec basename (lowercase)
      const execBase = basename(exec.split(" ")[0]).toLowerCase();
      if (seen.has(execBase)) continue;
      seen.add(execBase);

      apps.push({
        name: parsed.name,
        exec,
        description: parsed.comment,
        categories: parsed.categories,
        keywords: parsed.keywords,
        source: isUser ? "xdg-user" : "xdg",
        desktopFile: path,
        isGui: !parsed.terminal,
      });
    }
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Snap scanning
// ---------------------------------------------------------------------------

const SNAP_BIN_DIR = "/snap/bin";

export async function scanSnap(): Promise<AppEntry[]> {
  const apps: AppEntry[] = [];

  let entries: string[];
  try {
    entries = await readdir(SNAP_BIN_DIR);
  } catch {
    return [];
  }

  for (const name of entries) {
    const fullPath = join(SNAP_BIN_DIR, name);

    // Verify it's executable
    try {
      await access(fullPath, constants.X_OK);
    } catch {
      continue;
    }

    apps.push({
      name,
      exec: fullPath,
      description: `Snap package: ${name}`,
      categories: [],
      keywords: [],
      source: "snap",
      isGui: true, // snap binaries could be either, default to true
    });
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Flatpak scanning
// ---------------------------------------------------------------------------

const FLATPAK_BIN_DIR = "/var/lib/flatpak/exports/bin";

export async function scanFlatpak(): Promise<AppEntry[]> {
  const apps: AppEntry[] = [];

  let entries: string[];
  try {
    entries = await readdir(FLATPAK_BIN_DIR);
  } catch {
    return [];
  }

  for (const name of entries) {
    const fullPath = join(FLATPAK_BIN_DIR, name);

    try {
      await access(fullPath, constants.X_OK);
    } catch {
      continue;
    }

    apps.push({
      name,
      exec: fullPath,
      description: `Flatpak application: ${name}`,
      categories: [],
      keywords: [],
      source: "flatpak",
      isGui: true,
    });
  }

  return apps;
}

// ---------------------------------------------------------------------------
// PATH binary scanning
// ---------------------------------------------------------------------------

export async function scanPath(): Promise<AppEntry[]> {
  const pathEnv = process.env.PATH ?? "";
  if (!pathEnv) return [];

  const dirs = pathEnv.split(":").filter((d) => d.length > 0);
  const apps: AppEntry[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      // Deduplicate by name
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;

      const fullPath = join(dir, name);

      // Check if executable
      try {
        await access(fullPath, constants.X_OK);
      } catch {
        continue;
      }

      // Skip directories
      try {
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) continue;
      } catch {
        continue;
      }

      seen.add(lower);

      apps.push({
        name,
        exec: fullPath,
        description: `PATH binary: ${name}`,
        categories: [],
        keywords: [],
        source: "path",
        isGui: false, // PATH binaries are generally CLI
      });
    }
  }

  return apps;
}
