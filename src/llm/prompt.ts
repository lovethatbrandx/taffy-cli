import type { Config, AppRegistry } from "../types.js";
import { buildContextHistory } from "../context/history.js";

/**
 * Format the app registry into a human-readable inventory for the LLM.
 */
export function formatAppInventory(registry: AppRegistry): string {
  if (registry.apps.length === 0) {
    return "No applications found on this system.";
  }

  const lines: string[] = [
    `Installed applications (${registry.apps.length} total):`,
    "",
  ];

  for (const app of registry.apps) {
    const parts = [app.name];
    if (app.description) parts.push(`— ${app.description}`);
    if (app.categories.length > 0) parts.push(`[${app.categories.join(", ")}]`);
    parts.push(`(exec: ${app.exec})`);
    lines.push(`  ${parts.join(" ")}`);
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

  // 4. Shell history context (if enabled)
  const historyContext = buildContextHistory(config.context);
  if (historyContext) {
    sections.push(`## Shell History\n${historyContext}`);
  }

  // 5. Response format instructions
  sections.push(`## Response Format

You MUST respond with exactly one JSON object. No markdown fences, no explanation before or after.
Choose the action type that best fits the user's request:

**Command action** — run a shell command:
{"type":"command","command":"ls -la ~"}

**Launch action** — open an application:
{"type":"launch","app":"firefox"}
{"type":"launch","app":"vlc","args":"--fullscreen /path/to/video.mp4"}

**Composite action** — multiple steps in sequence:
{"type":"composite","steps":[{"type":"command","command":"cd ~/projects"},{"type":"launch","app":"code","args":"."}]}

**Error action** — if the request is unclear, dangerous, or impossible:
{"type":"error","message":"Cannot rm -rf / — this would destroy your system."}

Rules:
- "command" must be a valid shell command for ${process.platform === "win32" ? "PowerShell" : "the user's shell"}
- "launch" app name must exactly match an exec name from the Application Inventory when possible
- Use "composite" only when multiple distinct steps are needed
- Be precise. No extra commentary. Just the JSON.`);

  return sections.join("\n\n");
}
