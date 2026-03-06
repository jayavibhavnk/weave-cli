import type { ChatMessage } from "../core/types.js";

export interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[], model?: string): Promise<string>;
  stream(
    messages: ChatMessage[],
    model?: string
  ): AsyncIterable<string>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.apiKey = apiKey;
    this.defaultModel = model;
  }

  async chat(messages: ChatMessage[], model?: string): Promise<string> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const resp = await client.chat.completions.create({
      model: model || this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return resp.choices[0]?.message?.content || "";
  }

  async *stream(
    messages: ChatMessage[],
    model?: string
  ): AsyncIterable<string> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const stream = await client.chat.completions.create({
      model: model || this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, model = "claude-sonnet-4-20250514") {
    this.apiKey = apiKey;
    this.defaultModel = model;
  }

  async chat(messages: ChatMessage[], model?: string): Promise<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const resp = await client.messages.create({
      model: model || this.defaultModel,
      max_tokens: 4096,
      system: systemMsg?.content || "",
      messages: nonSystem.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    return textBlock ? (textBlock as { type: "text"; text: string }).text : "";
  }

  async *stream(
    messages: ChatMessage[],
    model?: string
  ): AsyncIterable<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const stream = client.messages.stream({
      model: model || this.defaultModel,
      max_tokens: 4096,
      system: systemMsg?.content || "",
      messages: nonSystem.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}

export function createProvider(
  provider: "openai" | "anthropic",
  apiKey: string,
  model?: string
): LLMProvider {
  if (provider === "anthropic") {
    return new AnthropicProvider(apiKey, model);
  }
  return new OpenAIProvider(apiKey, model);
}
