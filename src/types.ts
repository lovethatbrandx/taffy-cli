import { z } from "zod";

// Provider types
export const ProviderTypeSchema = z.enum(["OpenAI", "Custom", "Claude", "Gemini", "GitHub", "OpenRouter"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// Context config
export const ContextConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxHistoryCommands: z.number().int().min(1).max(100).default(10),
});
export type ContextConfig = z.infer<typeof ContextConfigSchema>;

// Scanner sources
export const ScannerSourcesSchema = z.object({
  xdgApplications: z.boolean().default(true),
  snap: z.boolean().default(true),
  flatpak: z.boolean().default(true),
  pathBinaries: z.boolean().default(true),
});
export type ScannerSources = z.infer<typeof ScannerSourcesSchema>;

// Scanner config
export const ScannerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  cacheMaxAgeMs: z.number().int().min(0).default(3600000), // 1 hour
  sources: ScannerSourcesSchema.default({}),
});
export type ScannerConfig = z.infer<typeof ScannerConfigSchema>;

// Helper: coerce null/undefined to default (handles legacy config files with null values)
const nullToDefault = (fallback: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? fallback : v),
    z.string().default(fallback),
  );

// Main config
export const ConfigSchema = z.object({
  type: ProviderTypeSchema.default("Custom"),
  apiKey: nullToDefault("ollama"),
  model: nullToDefault("llama3"),
  baseURL: nullToDefault("http://localhost:11434/v1"),
  context: ContextConfigSchema.default({}),
  clipboard: z.boolean().default(false),
  scanner: ScannerConfigSchema.default({}),
  soulPath: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

// App entry
export type AppSource = "xdg" | "xdg-user" | "snap" | "flatpak" | "path";

export interface AppEntry {
  name: string;
  exec: string;
  description: string;
  categories: string[];
  keywords: string[];
  source: AppSource;
  desktopFile?: string;
  isGui: boolean;
}

export interface AppRegistry {
  apps: AppEntry[];
  scannedAt: number;
  scanVersion: number;
}

// Action results from LLM
export interface CommandAction {
  type: "command";
  command: string;
}
export interface LaunchAction {
  type: "launch";
  app: string;
  args?: string;
}
export interface CompositeAction {
  type: "composite";
  steps: Array<CommandAction | LaunchAction>;
}
export interface ErrorAction {
  type: "error";
  message: string;
}
export type ActionResult = CommandAction | LaunchAction | CompositeAction | ErrorAction;

// LLM provider interface
export interface LLMProvider {
  readonly name: string;
  generate(systemPrompt: string, userMessage: string): Promise<string>;
}

// Zod schemas for LLM action JSON validation
export const CommandActionSchema = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
});

export const LaunchActionSchema = z.object({
  type: z.literal("launch"),
  app: z.string().min(1),
  args: z.string().optional(),
});

export const CompositeActionSchema = z.object({
  type: z.literal("composite"),
  steps: z.array(
    z.union([CommandActionSchema, LaunchActionSchema])
  ).min(1),
});

export const ErrorActionSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ActionResultSchema = z.union([
  CommandActionSchema,
  LaunchActionSchema,
  CompositeActionSchema,
  ErrorActionSchema,
]);
