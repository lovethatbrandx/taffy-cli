import type { Config, AppRegistry, AppEntry } from "../types.js";
import { buildContextHistory } from "../context/history.js";

/**
 * Format the app registry into a compact inventory for the LLM.
 * Groups by category, only includes useful metadata.
 */
export function formatAppInventory(registry: AppRegistry): string {
  if (registry.apps.length === 0) {
    return "No applications found on this system.";
  }

  // Separate GUI apps from CLI tools
  const guiApps = registry.apps.filter((a) => a.isGui);
  const cliApps = registry.apps.filter((a) => !a.isGui);

  const lines: string[] = [];

  if (guiApps.length > 0) {
    lines.push(`GUI Applications (${guiApps.length}):`);
    for (const app of guiApps) {
      const desc = app.description ? ` — ${app.description}` : "";
      const cats = app.categories.length > 0 ? ` [${app.categories.join(", ")}]` : "";
      lines.push(`  ${app.name}${desc}${cats} → ${app.exec}`);
    }
    lines.push("");
  }

  if (cliApps.length > 0) {
    lines.push(`CLI Tools (${cliApps.length}):`);
    for (const app of cliApps) {
      const desc = app.description ? ` — ${app.description}` : "";
      lines.push(`  ${app.name}${desc} → ${app.exec}`);
    }
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

**Error action** — if the request is unclear, dangerous, or IMPOSSIBLE because no installed app can do it:
{"type":"error","message":"dude, nothing on this box can play music — you'd need to install mpv or something"}

CRITICAL RULES:
- "command" must be a valid shell command for ${process.platform === "win32" ? "PowerShell" : "the user's shell"}
- "launch" app name must exactly match an exec name from the Application Inventory
- If the user's request requires an app that ISN'T in the Application Inventory, use an error action. Do NOT generate a command that will fail. Do NOT guess an app name.
- Use "composite" only when multiple distinct steps are needed
- Be precise. No extra commentary. Just the JSON.
- For casual/vague requests ("bump some tunes", "let's boogie", "time to surf the net"), match the intent to the best available app. If nothing fits, error action with a natural explanation.`);

  return sections.join("\n\n");
}
