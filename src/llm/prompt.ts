import type { Config, AppRegistry, AppEntry } from "../types.js";
import { buildContextHistory } from "../context/history.js";

/**
 * Format the app registry into a compact inventory for the LLM.
 * Keeps it minimal — name and description only, no paths or categories.
 * The LLM just needs to know what's available, not where the binary lives.
 */
export function formatAppInventory(registry: AppRegistry): string {
  if (registry.apps.length === 0) {
    return "No applications found on this system.";
  }

  // XDG apps — real metadata from .desktop files
  const xdgApps = registry.apps.filter((a) => a.source === "xdg" || a.source === "xdg-user");

  // PATH binaries with real descriptions only
  const pathApps = registry.apps.filter(
    (a) =>
      a.source === "path" &&
      a.description &&
      !a.description.startsWith("PATH binary:"),
  );

  // Snap/flatpak with metadata
  const otherApps = registry.apps.filter(
    (a) =>
      (a.source === "snap" || a.source === "flatpak") &&
      a.description &&
      !a.description.startsWith("PATH binary:"),
  );

  const lines: string[] = [];

  // XDG GUI apps
  const gui = xdgApps.filter((a) => a.isGui);
  const cli = xdgApps.filter((a) => !a.isGui);

  if (gui.length > 0) {
    lines.push("GUI apps:");
    for (const app of gui) {
      const desc = app.description || app.name;
      lines.push(`  ${app.exec} — ${desc}`);
    }
    lines.push("");
  }

  if (cli.length > 0) {
    lines.push("Terminal apps:");
    for (const app of cli) {
      const desc = app.description || app.name;
      lines.push(`  ${app.exec} — ${desc}`);
    }
    lines.push("");
  }

  // PATH binaries with real descriptions
  if (pathApps.length > 0) {
    lines.push("CLI tools:");
    for (const app of pathApps) {
      lines.push(`  ${app.exec} — ${app.description}`);
    }
    lines.push("");
  }

  // Snap/flatpak
  if (otherApps.length > 0) {
    lines.push("Packages:");
    for (const app of otherApps) {
      lines.push(`  ${app.exec} — ${app.description}`);
    }
  }

  const total = xdgApps.length + pathApps.length + otherApps.length;
  if (total === 0) {
    return "No applications with metadata found.";
  }

  return lines.join("\n");
}

/**
 * Compose the full system prompt from SOUL + environment + apps + history + format instructions.
 */
export function buildSystemPrompt(
  config: Config,
  soul: string,
  registry: AppRegistry,
): string {
  const sections: string[] = [];

  // 1. Personality / SOUL
  sections.push(soul);

  // 2. Environment context
  const envInfo = [
    `Platform: ${process.platform}`,
    `Architecture: ${process.arch}`,
    `Shell: ${process.env.SHELL ?? "unknown"}`,
    `Home: ${process.env.HOME ?? process.env.USERPROFILE ?? "unknown"}`,
    `User: ${process.env.USER ?? process.env.LOGNAME ?? "unknown"}`,
  ];
  sections.push(`## Environment\n${envInfo.join("\n")}`);

  // 3. App inventory
  sections.push(`## Application Inventory\n${formatAppInventory(registry)}`);

  // 4. User defaults — preferred apps for common tasks
  const defaults = config.defaults;
  if (Object.keys(defaults).length > 0) {
    const defaultsLines = Object.entries(defaults).map(
      ([category, app]) => `  ${category}: ${app}`,
    );
    sections.push(`## Preferred Apps\n${defaultsLines.join("\n")}\n\nWhen multiple apps can do the same job, always prefer the user's preferred app listed above.`);
  }

  // 5. Shell history context (if enabled)
  const historyContext = buildContextHistory(config.context);
  if (historyContext) {
    sections.push(`## Shell History\n${historyContext}`);
  }

  // 5. Response format instructions
  sections.push(`## Response Format

You MUST respond with exactly one JSON object. No markdown fences, no explanation before or after.

**Command action (single command):**
{"type":"command","command":"python3 -m venv .venv"}

**Command action (multiple commands joined with &&):**
{"type":"command","command":"python3 -m venv .venv && source .venv/bin/activate && pip install requests"}

**Launch action — open an app:**
{"type":"launch","app":"btop"}

**Error action — can't do it:**
{"type":"error","message":"nothing on this box can do that"}

RULES:
- User wants to OPEN/USE an app → launch action. App opens immediately.
- User wants a COMMAND → command action. Command is printed for review.
- User wants MULTIPLE commands → join them with && in a single command action.
- Commands are ALWAYS shown for review. Never auto-execute.
- "launch" app name must match an exec name from the Application Inventory.
- If no app can do it → error action.
- Just the JSON. No extra text.`);

  return sections.join("\n\n");
}
