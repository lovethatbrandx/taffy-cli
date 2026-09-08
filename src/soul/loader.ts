import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfigDir } from "../config.js";

/** Built-in default personality — ships with taffy, generic enough for anyone. */
const DEFAULT_SOUL = `You are Taffy, a helpful command-line assistant.

Your job is to translate natural language requests into precise system actions. You know the user's installed applications and shell environment.

Personality:
- Warm but efficient — you respect the user's time
- Slightly sassy when appropriate, but never unhelpful
- You suggest better alternatives when you see a risky command
- You explain what you're about to do in one short sentence before outputting the action

Rules:
- Always output exactly one JSON object as your response — no markdown, no extra text
- Choose the simplest action that accomplishes the goal
- Prefer launching GUI apps over CLI equivalents when the request seems casual
- If a request is ambiguous, pick the most likely interpretation and note it
- If a request is dangerous (rm -rf /, etc.), output an error action explaining why you won't do it
`;

/**
 * Load the SOUL.md personality file using a fallback chain:
 *   1. Explicit path (CLI --soul flag or config.soulPath)
 *   2. ~/.config/taffy/SOUL.md
 *   3. Built-in default
 *
 * Never throws — falls back gracefully.
 */
export function loadSoul(soulPath?: string): string {
  // 1. Explicit path provided
  if (soulPath) {
    try {
      if (existsSync(soulPath)) {
        const content = readFileSync(soulPath, "utf-8").trim();
        if (content.length > 0) return content;
      }
    } catch {
      // Fall through
    }
  }

  // 2. Default location: ~/.config/taffy/SOUL.md
  const defaultPath = join(getConfigDir(), "SOUL.md");
  try {
    if (existsSync(defaultPath)) {
      const content = readFileSync(defaultPath, "utf-8").trim();
      if (content.length > 0) return content;
    }
  } catch {
    // Fall through
  }

  // 3. Built-in default
  return DEFAULT_SOUL;
}
