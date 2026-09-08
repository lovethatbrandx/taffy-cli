import type { Config, AppRegistry, AppEntry } from "../types.js";
import { buildContextHistory } from "../context/history.js";

/**
 * Format the app registry into a compact inventory for the LLM.
 * Only includes apps with real metadata — filters out noise from PATH binaries
 * that have no description or categories.
 */
export function formatAppInventory(registry: AppRegistry): string {
  if (registry.apps.length === 0) {
    return "No applications found on this system.";
  }

  // XDG apps always have real metadata from .desktop files
  const xdgApps = registry.apps.filter((a) => a.source === "xdg" || a.source === "xdg-user");

  // PATH binaries: only include those with a meaningful description
  // (not just "PATH binary: name" which is the default for unscanned binaries)
  const pathApps = registry.apps.filter(
    (a) =>
      a.source === "path" &&
      a.description &&
      !a.description.startsWith("PATH binary:"),
  );

  // Snap/flatpak apps: include if they have metadata
  const otherApps = registry.apps.filter(
    (a) =>
      (a.source === "snap" || a.source === "flatpak") &&
      a.description &&
      !a.description.startsWith("PATH binary:"),
  );

  const lines: string[] = [];

  // XDG apps — the good stuff, always useful
  if (xdgApps.length > 0) {
    // Separate GUI from terminal apps
    const gui = xdgApps.filter((a) => a.isGui);
    const cli = xdgApps.filter((a) => !a.isGui);

    if (gui.length > 0) {
      lines.push(`GUI Applications (${gui.length}):`);
      for (const app of gui) {
        const desc = app.description ? ` — ${app.description}` : "";
        const cats = app.categories.length > 0 ? ` [${app.categories.join(", ")}]` : "";
        lines.push(`  ${app.name}${desc}${cats} → ${app.exec}`);
      }
      lines.push("");
    }

    if (cli.length > 0) {
      lines.push(`Terminal Applications (${cli.length}):`);
      for (const app of cli) {
        const desc = app.description ? ` — ${app.description}` : "";
        const cats = app.categories.length > 0 ? ` [${app.categories.join(", ")}]` : "";
        lines.push(`  ${app.name}${desc}${cats} → ${app.exec}`);
      }
      lines.push("");
    }
  }

  // PATH binaries with real descriptions
  if (pathApps.length > 0) {
    lines.push(`CLI Tools (${pathApps.length}):`);
    for (const app of pathApps) {
      lines.push(`  ${app.name} — ${app.description} → ${app.exec}`);
    }
    lines.push("");
  }

  // Snap/flatpak
  if (otherApps.length > 0) {
    lines.push(`Packages (${otherApps.length}):`);
    for (const app of otherApps) {
      lines.push(`  ${app.name} — ${app.description} → ${app.exec}`);
    }
  }

  const total = xdgApps.length + pathApps.length + otherApps.length;
  if (total === 0) {
    return "No applications with sufficient metadata found. The system has CLI tools in PATH but no detailed inventory.";
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
Choose the action type that best fits the user's request:

**Command action** — run a shell command:
{"type":"command","command":"ls -la ~","auto":false}

**Auto-execute command** — simple, safe commands that should just run immediately:
{"type":"command","command":"find /home -size +100M -type f","auto":true}
{"type":"command","command":"df -h","auto":true}
{"type":"command","command":"uptime","auto":true}

**Launch action** — open an application (always auto-executes):
{"type":"launch","app":"firefox"}

**Composite action** — multiple steps in sequence:
{"type":"composite","steps":[{"type":"command","command":"cd ~/projects"},{"type":"launch","app":"code","args":"."}],"auto":true}

**Error action** — if the request is unclear, dangerous, or IMPOSSIBLE because no installed app can do it:
{"type":"error","message":"dude, nothing on this box can play music — you'd need to install mpv or something"}

THE "auto" FLAG:
- Set "auto": true when the request is simple and safe — user wants it done NOW, not shown for review.
  Examples: find files, check disk space, list processes, check uptime, system info, restart a service.
- Set "auto": false (or omit it) when the user might want to review/edit before running.
  Examples: complex commands, commands with side effects, commands the user phrased as "how do I..." or "what's the command for..."
- NEVER auto-execute: rm -rf, DROP TABLE, shutdown, reboot, kill, mkfs, dd, anything that destroys data or stops the system.
- When in doubt, auto:false.

CRITICAL RULES:
- "command" must be a valid shell command for ${process.platform === "win32" ? "PowerShell" : "the user's shell"}
- "launch" app name must exactly match an exec name from the Application Inventory
- If the user's request requires an app that ISN'T in the Application Inventory, use an error action. Do NOT generate a command that will fail. Do NOT guess an app name.
- Use "composite" only when multiple distinct steps are needed
- Be precise. No extra commentary. Just the JSON.
- For casual/vague requests ("bump some tunes", "let's boogie", "time to surf the net"), match the intent to the best available app. If nothing fits, error action with a natural explanation.`);

  return sections.join("\n\n");
}
