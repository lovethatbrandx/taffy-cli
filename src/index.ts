#!/usr/bin/env bun
import { loadConfig, saveConfig } from "./config.js";
import { fullScan } from "./scanner/app-scanner.js";
import { loadRegistry, getOrRescan, saveRegistry } from "./scanner/registry.js";
import { loadSoul } from "./soul/loader.js";
import { createProvider } from "./llm/providers.js";
import { buildSystemPrompt } from "./llm/prompt.js";
import { parseLLMResponse } from "./llm/response.js";
import type { ActionResult, CompositeAction, Config, AppRegistry } from "./types.js";
import { execSync } from "child_process";

const VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  rescan: boolean;
  soulPath?: string;
  noScan: boolean;
  prompt: string[];
  help: boolean;
  version: boolean;
  setDefault?: { category: string; app: string };
  listDefaults: boolean;
  update: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    rescan: false,
    noScan: false,
    prompt: [],
    help: false,
    version: false,
    listDefaults: false,
    update: false,
  };

  const raw = argv.slice(2); // skip node/bun and script path
  let i = 0;

  while (i < raw.length) {
    const arg = raw[i];

    if (arg === "--rescan") {
      args.rescan = true;
    } else if (arg === "--no-scan") {
      args.noScan = true;
    } else if (arg === "--soul") {
      i++;
      args.soulPath = raw[i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--version" || arg === "-v") {
      args.version = true;
    } else if (arg === "--set-default") {
      i++;
      const category = raw[i];
      i++;
      const app = raw[i];
      if (!category || !app) {
        process.stderr.write("[taffy] Usage: taffy --set-default <category> <app>\n");
        process.stderr.write("  Example: taffy --set-default editor vim\n");
        process.exit(1);
      }
      args.setDefault = { category, app };
    } else if (arg === "--defaults") {
      args.listDefaults = true;
    } else if (arg === "--update") {
      args.update = true;
    } else if (arg === "--") {
      // Everything after -- is the prompt
      i++;
      while (i < raw.length) {
        args.prompt.push(raw[i]);
        i++;
      }
      break;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`[taffy] Unknown flag: ${arg}\n`);
      process.exit(1);
    } else {
      // Positional arguments are the prompt
      args.prompt.push(arg);
    }

    i++;
  }

  return args;
}

function printHelp(): void {
  process.stdout.write(`taffy — Natural language to action on the command line.

USAGE:
  taffy [OPTIONS] <prompt>

OPTIONS:
  --rescan                      Force a fresh application scan (ignore cache)
  --no-scan                     Skip application scanning entirely
  --soul <path>                 Load personality from a specific SOUL.md file
  --set-default <category> <app>  Set preferred app for a category
  --defaults                    Show current app defaults
  --update                      Pull latest from git, rebuild, reinstall
  -v, --version                 Show version
  -h, --help                    Show this help message

EXAMPLES:
  taffy "find large files"
  taffy "open firefox"
  taffy --rescan "launch the music player"
  taffy --set-default editor vim
  taffy --set-default browser chromium
  taffy --defaults

CONFIGURATION:
  Config file:   ~/.config/taffy/config.json
  SOUL.md:       ~/.config/taffy/SOUL.md
  App registry:  ~/.config/taffy/registry.json

ENVIRONMENT:
  TAFFY_API_KEY        API key for the LLM provider
  TAFFY_MODEL          Model name
  TAFFY_BASE_URL       API endpoint
  TAFFY_PROVIDER_TYPE  Provider: OpenAI, Custom, Claude, Gemini, GitHub, OpenRouter
  TAFFY_CLIPBOARD      Copy commands to clipboard (true/false)
`);
}

// ---------------------------------------------------------------------------
// Taffy-isms — random flavor text before responses
// ---------------------------------------------------------------------------

const TAFFY_ISMS = [
  "sure thing",
  "totally",
  "gotchu",
  "on it",
  "you got it",
  "bet",
  "say less",
  "easy",
  "done",
  "no worries",
  "I got you",
  "yep",
  "alright",
  "let's go",
  "here you go",
  "boom",
  "okay okay",
  "right on",
  "cool cool",
  "yup",
];

function taffyIsm(): string {
  return TAFFY_ISMS[Math.floor(Math.random() * TAFFY_ISMS.length)];
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

function dispatchAction(action: ActionResult, config: Config): void {
  switch (action.type) {
    case "command":
      process.stdout.write(action.command + "\n");
      if (config.clipboard) {
        copyToClipboard(action.command);
      }
      break;

    case "launch":
      // Run the app in foreground with terminal access
      // Terminal apps (btop, htop) need stdio: "inherit" to display correctly
      // GUI apps will open a window and return when closed
      try {
        execSync(action.app + (action.args ? " " + action.args : ""), {
          stdio: "inherit",
        });
      } catch {
        // App exited with non-zero — that's fine, it still ran
      }
      break;

    case "composite":
      dispatchComposite(action, config);
      break;

    case "error":
      process.stdout.write(action.message + "\n");
      break;

    default:
      process.stderr.write("[taffy] Unknown action type\n");
      process.exit(1);
  }
}

function dispatchComposite(action: CompositeAction, config: Config): void {
  const parts: string[] = [];
  for (const step of action.steps) {
    switch (step.type) {
      case "command":
        parts.push(step.command);
        break;
      case "launch":
        parts.push(`${step.app}${step.args ? " " + step.args : ""}`);
        break;
    }
  }
  const combined = parts.join(" && ");
  process.stdout.write(combined + "\n");
  if (config.clipboard) {
    copyToClipboard(combined);
  }
}

function copyToClipboard(text: string): void {
  try {
    // Detect available clipboard utility
    const platform = process.platform;
    if (platform === "linux") {
      // Try xclip, then xsel
      try {
        execSync("xclip -selection clipboard", {
          input: text,
          stdio: ["pipe", "ignore", "ignore"],
          timeout: 2000,
        });
        return;
      } catch {
        // Fall through
      }
      try {
        execSync("xsel --clipboard --input", {
          input: text,
          stdio: ["pipe", "ignore", "ignore"],
          timeout: 2000,
        });
        return;
      } catch {
        // Fall through
      }
    } else if (platform === "darwin") {
      execSync("pbcopy", {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 2000,
      });
      return;
    } else if (platform === "win32") {
      execSync("clip", {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 2000,
      });
      return;
    }

    process.stderr.write("[taffy] No clipboard utility found (tried xclip, xsel, pbcopy, clip)\n");
  } catch {
    process.stderr.write("[taffy] Failed to copy to clipboard\n");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.version) {
    process.stdout.write(`taffy v${VERSION}\n`);
    process.exit(0);
  }

  if (args.update) {
    process.stdout.write("updating taffy...\n");

    // Find the repo directory — works from compiled binary or bun run
    const repoDir = process.env.TAFFY_REPO_DIR
      ?? "/home/reposed/brandx/taffy-cli";

    const updateScript = [
      "set -e",
      `cd "${repoDir}"`,
      "echo 'pulling latest...'",
      "git pull --quiet",
      "echo 'building...'",
      "bun run build",
      "echo 'installing...'",
      "sudo cp dist/taffy /usr/local/bin/taffy.tmp",
      "sudo mv /usr/local/bin/taffy.tmp /usr/local/bin/taffy",
      "sudo chmod +x /usr/local/bin/taffy",
      "echo done",
    ].join(" && ");

    try {
      execSync(updateScript, { stdio: "inherit" });
    } catch {
      process.stderr.write("[taffy] update failed.\n");
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // 1. Load config
  const config: Config = loadConfig();

  // Handle --set-default
  if (args.setDefault) {
    const { category, app } = args.setDefault;
    config.defaults[category] = app;
    saveConfig(config);
    process.stdout.write(`gotchu, default ${category} set to ${app}\n`);
    process.exit(0);
  }

  // Handle --defaults
  if (args.listDefaults) {
    const entries = Object.entries(config.defaults);
    if (entries.length === 0) {
      process.stdout.write("no defaults set yet. use --set-default <category> <app> to set one\n");
    } else {
      process.stdout.write("your app defaults:\n");
      for (const [category, app] of entries) {
        process.stdout.write(`  ${category}: ${app}\n`);
      }
    }
    process.exit(0);
  }

  const prompt = args.prompt.join(" ").trim();
  if (prompt.length === 0) {
    process.stderr.write("[taffy] No prompt provided. Use --help for usage.\n");
    process.exit(1);
  }

  // 2. Load or rescan registry
  let registry: AppRegistry;

  if (args.noScan) {
    // Use empty registry
    registry = { apps: [], scannedAt: 0, scanVersion: 1 };
  } else if (args.rescan) {
    registry = await fullScan(config);
  } else {
    registry = await getOrRescan(config, async () => fullScan(config));
  }

  // 3. Load SOUL
  const soul = loadSoul(args.soulPath ?? config.soulPath);

  // 4. Build system prompt
  const systemPrompt = buildSystemPrompt(config, soul, registry);

  // 5. Create LLM provider and generate
  const provider = createProvider(config);

  let rawResponse: string;
  try {
    rawResponse = await provider.generate(systemPrompt, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[taffy] LLM request failed: ${msg}\n`);
    process.exit(1);
  }

  // 6. Parse response
  const action = parseLLMResponse(rawResponse);

  // 7. Dispatch
  dispatchAction(action, config);

  // Exit cleanly — Bun sometimes hangs after execSync returns
  process.exit(0);
}

// Run
main().catch((err) => {
  process.stderr.write(`[taffy] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
