import type { Config, LLMProvider } from "../types.js";

// ---------------------------------------------------------------------------
// Custom / Ollama provider (OpenAI-compatible API)
// ---------------------------------------------------------------------------

class CustomProvider implements LLMProvider {
  readonly name = "Custom";

  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

class OpenAIProvider implements LLMProvider {
  readonly name = "OpenAI";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Claude (Anthropic) provider
// ---------------------------------------------------------------------------

class ClaudeProvider implements LLMProvider {
  readonly name = "Claude";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text from content blocks
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      }
    }

    return textParts.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Gemini (Google Generative AI) provider
// ---------------------------------------------------------------------------

class GeminiProvider implements LLMProvider {
  readonly name = "Gemini";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(userMessage);
    const response = result.response;

    return response.text();
  }
}

// ---------------------------------------------------------------------------
// GitHub (Azure AI Inference) provider
// ---------------------------------------------------------------------------

class GitHubProvider implements LLMProvider {
  readonly name = "GitHub";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const { isUnexpected } = await import("@azure-rest/ai-inference");
    const ModelClient = (await import("@azure-rest/ai-inference")).default;

    const client = ModelClient(
      "https://models.inference.ai.azure.com",
      { key: this.apiKey },
    );

    const response = await client.path("/chat/completions").post({
      body: {
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
      },
    });

    if (isUnexpected(response)) {
      throw new Error(`GitHub Models API error: HTTP ${JSON.stringify(response.body)}`);
    }

    const body = response.body as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return body.choices?.[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// OpenRouter provider (OpenAI-compatible API)
// ---------------------------------------------------------------------------

class OpenRouterProvider implements LLMProvider {
  readonly name = "OpenRouter";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an LLM provider based on config.type.
 */
export function createProvider(config: Config): LLMProvider {
  switch (config.type) {
    case "Custom":
      return new CustomProvider(config);
    case "OpenAI":
      return new OpenAIProvider(config);
    case "Claude":
      return new ClaudeProvider(config);
    case "Gemini":
      return new GeminiProvider(config);
    case "GitHub":
      return new GitHubProvider(config);
    case "OpenRouter":
      return new OpenRouterProvider(config);
    default: {
      // Exhaustive check
      const _exhaustive: never = config.type;
      process.stderr.write(`[taffy] Unknown provider type: ${String(_exhaustive)}\n`);
      process.stderr.write("[taffy] Falling back to Custom (Ollama).\n");
      return new CustomProvider(config);
    }
  }
}
