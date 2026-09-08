import type { ActionResult } from "../types.js";
import { ActionResultSchema } from "../types.js";

/**
 * Strip thinking/reasoning blocks that some LLMs emit.
 * Handles: <thinking>...</thinking>, <think>...</think>, <reasoning>...</reasoning>
 */
function stripThinkingBlocks(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  return cleaned.trim();
}

/**
 * Try to extract a JSON object from the response.
 * Handles: raw JSON, JSON inside ```json ... ``` fences, JSON inside ``` ... ``` fences.
 */
function extractJSON(text: string): string | null {
  // 1. Try to find JSON in code fences
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    if (candidate.startsWith("{")) return candidate;
  }

  // 2. Try to find a raw JSON object in the text
  // Look for the first { to the last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    // Validate it's at least parseable JSON
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not valid JSON, fall through
    }
  }

  return null;
}

/**
 * Normalize action JSON keys.
 * LLMs sometimes output "action" instead of "type", and "steps" items may have "action" too.
 * The Zod schemas expect "type".
 */
function normalizeActionKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result = { ...obj };

  // Normalize top-level "action" → "type"
  if ("action" in result && !("type" in result)) {
    result["type"] = result["action"];
    delete result["action"];
  }

  // Normalize steps inside composite actions
  if (result["type"] === "composite" && Array.isArray(result["steps"])) {
    result["steps"] = (result["steps"] as Record<string, unknown>[]).map(
      (step: Record<string, unknown>) => {
        if ("action" in step && !("type" in step)) {
          const normalized = { ...step };
          normalized["type"] = normalized["action"];
          delete normalized["action"];
          return normalized;
        }
        return step;
      },
    );
  }

  return result;
}

/**
 * Parse LLM response text into a validated ActionResult.
 *
 * Steps:
 *  1. Strip <thinking> blocks
 *  2. Try to extract JSON object
 *  3. Normalize key names (action → type)
 *  4. Validate with Zod schema
 *  5. Fallback: treat entire cleaned text as a shell command (uwu compatibility)
 */
export function parseLLMResponse(raw: string): ActionResult {
  // 1. Strip thinking blocks
  const cleaned = stripThinkingBlocks(raw);

  // 2. Try to extract JSON
  const jsonStr = extractJSON(cleaned);

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      // 3. Normalize keys
      const normalized = normalizeActionKeys(parsed);

      // 4. Validate with Zod
      const result = ActionResultSchema.safeParse(normalized);
      if (result.success) {
        return result.data;
      }

      // If validation failed, try to give a useful error
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      process.stderr.write(`[taffy] LLM response validation failed: ${issues}\n`);
      process.stderr.write(`[taffy] Raw JSON: ${jsonStr}\n`);
    } catch (parseErr) {
      process.stderr.write(
        `[taffy] Failed to parse JSON from LLM response: ${String(parseErr)}\n`,
      );
    }
  }

  // 5. Fallback: treat entire cleaned text as a shell command (uwu compatibility)
  // Only do this if the text looks like it could be a command (not empty, not too long)
  const trimmed = cleaned.trim();
  if (trimmed.length > 0 && trimmed.length < 4096) {
    process.stderr.write("[taffy] Falling back to raw command interpretation.\n");
    return { type: "command", command: trimmed };
  }

  return { type: "error", message: "Could not parse LLM response into a valid action." };
}
