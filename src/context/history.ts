import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ContextConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Shell history file detection
// ---------------------------------------------------------------------------

interface HistorySource {
  path: string;
  shell: string;
}

function detectHistoryFiles(): HistorySource[] {
  const home = homedir();
  const sources: HistorySource[] = [];

  // Zsh history
  const zshHist = join(home, ".zsh_history");
  if (existsSync(zshHist)) {
    sources.push({ path: zshHist, shell: "zsh" });
  }

  // Bash history
  const bashHist = join(home, ".bash_history");
  if (existsSync(bashHist)) {
    sources.push({ path: bashHist, shell: "bash" });
  }

  // Fish history
  const fishHist = join(home, ".local/share/fish/fish_history");
  if (existsSync(fishHist)) {
    sources.push({ path: fishHist, shell: "fish" });
  }

  // PowerShell history (cross-platform)
  const psHistDirs = [
    join(home, ".local/share/powershell/PSReadLine/ConsoleHost_history.txt"),
    join(home, "AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt"),
  ];
  for (const psHist of psHistDirs) {
    if (existsSync(psHist)) {
      sources.push({ path: psHist, shell: "powershell" });
      break;
    }
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Efficient last-N-lines reader (chunked backwards read)
// ---------------------------------------------------------------------------

/**
 * Read the last N lines from a file efficiently by reading chunks from the end.
 * Avoids loading the entire file into memory for large history files.
 */
function readLastLines(filePath: string, maxLines: number): string[] {
  try {
    const fileSize = statSync(filePath).size;
    if (fileSize === 0) return [];

    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const fd = openSync(filePath, "r");

    const lines: string[] = [];
    let position = fileSize;
    let remainder = "";

    try {
      while (position > 0 && lines.length < maxLines) {
        const chunkSize = Math.min(CHUNK_SIZE, position);
        position -= chunkSize;

        const buffer = Buffer.alloc(chunkSize);
        readSync(fd, buffer, 0, chunkSize, position);

        const chunk = buffer.toString("utf-8") + remainder;
        const chunkLines = chunk.split("\n");

        // The first element may be a partial line (if we're not at the start of file)
        if (position > 0) {
          remainder = chunkLines[0] ?? "";
          // Process all complete lines (everything after the first partial)
          for (let i = chunkLines.length - 1; i >= 1; i--) {
            const line = chunkLines[i].trim();
            if (line.length > 0) {
              lines.push(line);
              if (lines.length >= maxLines) break;
            }
          }
        } else {
          // We've read the entire file — process all lines
          for (let i = chunkLines.length - 1; i >= 0; i--) {
            const line = chunkLines[i].trim();
            if (line.length > 0) {
              lines.push(line);
              if (lines.length >= maxLines) break;
            }
          }
        }
      }
    } finally {
      closeSync(fd);
    }

    // Lines were collected newest-first, reverse to get chronological order
    return lines.reverse();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// History line cleaning
// ---------------------------------------------------------------------------

/**
 * Clean a raw history line into a plain command string.
 * Handles:
 *  - Zsh extended history format: `: 1234567890:0;command`
 *  - Fish history format: `- cmd: command` / `- cmd: command\n  when: ...`
 *  - Leading `$ ` or `> ` prompts
 *  - Timestamps and metadata
 */
function cleanHistoryLine(raw: string): string | null {
  let line = raw.trim();
  if (!line) return null;

  // Zsh extended history: `: <timestamp>:<duration>;command`
  const zshMatch = line.match(/^:\s*\d+:\d+;(.+)$/);
  if (zshMatch) {
    line = zshMatch[1].trim();
  }

  // Fish history: `- cmd: command`
  const fishMatch = line.match(/^- cmd:\s*(.+)$/);
  if (fishMatch) {
    line = fishMatch[1].trim();
  }

  // Strip leading prompt characters
  line = line.replace(/^[$>]\s+/, "");

  // Skip empty, comments, and common noise
  if (!line || line.startsWith("#")) return null;

  // Skip lines that are just whitespace or control chars
  if (/^[\s\x00-\x1f]+$/.test(line)) return null;

  return line;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a context string from shell history for the LLM system prompt.
 * Returns a formatted string of recent commands, or empty string if disabled.
 */
export function buildContextHistory(config: ContextConfig): string {
  if (!config.enabled) return "";

  const sources = detectHistoryFiles();
  if (sources.length === 0) return "";

  // Use the first available history source (priority: zsh > bash > fish > powershell)
  const source = sources[0];
  const rawLines = readLastLines(source.path, config.maxHistoryCommands * 2); // read extra to account for filtering

  const commands: string[] = [];
  for (const raw of rawLines) {
    const cleaned = cleanHistoryLine(raw);
    if (cleaned) {
      commands.push(cleaned);
    }
    if (commands.length >= config.maxHistoryCommands) break;
  }

  if (commands.length === 0) return "";

  const header = `Recent shell history (${source.shell}):`;
  const formatted = commands.map((cmd) => `  $ ${cmd}`).join("\n");

  return `${header}\n${formatted}`;
}
