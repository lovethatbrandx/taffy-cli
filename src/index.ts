#!/usr/bin/env bun
import { loadConfig } from "./config.js";
import { fullScan } from "./scanner/app-scanner.js";
import { loadRegistry, getOrRescan, saveRegistry } from "./scanner/registry.js";
import { loadSoul } from "./soul/loader.js";
import { createProvider } from "./llm/providers.js";
import { buildSystemPrompt } from "./llm/prompt.js";
import { parseLLMResponse } from "./llm/response.js";
import type { ActionResult, CompositeAction, Config, AppRegistry } from "./types.js";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  rescan: boolean;
  soulPath?: string;
  noScan: boolean;
  prompt: string[];
  help: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    rescan: false,
    noScan: false,
    prompt: [],
    help: false,
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
  --rescan       Force a fresh application scan (ignore cache)
  --no-scan      Skip application scanning entirely
  --soul <path>  Load personality from a specific SOUL.md file
  -h, --help     Show this help message

EXAMPLES:
  taffy "open firefox"
  taffy "list large files in home directory"
  taffy --rescan "launch the music player"
  taffy --soul ~/.my-soul.md "what's on my system?"

CONFIGURATION:
  Config file:   ~/.config/taffy/config.json
  SOUL.md:       ~/.config/taffy/SOUL.md
  App registry:  ~/.config/taffy/registry.json

ENVIRONMENT:
  TAFFY_API_KEY        API key for the LLM provider
  TAFFY_MODEL          Model name (default: llama3)
  TAFFY_BASE_URL       Base URL for API calls (default: http://localhost:11434/v1)
  TAFFY_PROVIDER_TYPE  Provider type: OpenAI, Custom, Claude, Gemini, GitHub, OpenRouter
  TAFFY_CLIPBOARD      Copy commands to clipboard (true/false)
`);
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
      process.stdout.write(`launch ${action.app}${action.args ? " " + action.args : ""}\n`);
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
  process.stdout.write("--- Composite Action ---\n");
  for (let i = 0; i < action.steps.length; i++) {
    const step = action.steps[i];
    process.stdout.write(`[${i + 1}/${action.steps.length}] `);

    switch (step.type) {
      case "command":
        process.stdout.write(`Run: ${step.command}\n`);
        if (config.clipboard) {
          copyToClipboard(step.command);
        }
        break;
      case "launch":
        process.stdout.write(`Launch: ${step.app}${step.args ? " " + step.args : ""}\n`);
        break;
    }
  }
  process.stdout.write("--- End Composite ---\n");
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

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const prompt = args.prompt.join(" ").trim();
  if (prompt.length === 0) {
    process.stderr.write("[taffy] No prompt provided. Use --help for usage.\n");
    process.exit(1);
  }

  // 1. Load config
  const config: Config = loadConfig();

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

  process.stderr.write(`[taffy] Asking ${provider.name} (${config.model})...\n`);

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
}

// Run
main().catch((err) => {
  process.stderr.write(`[taffy] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
