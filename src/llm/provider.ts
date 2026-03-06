import type { ChatMessage } from "../core/types.js";
import type { ToolDef } from "../tools/definitions.js";
import { toOpenAITools, toAnthropicTools } from "../tools/definitions.js";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[], model?: string): Promise<string>;
  stream(messages: ChatMessage[], model?: string): AsyncIterable<string>;
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): Promise<AgentResponse>;
  buildToolResultMessages(
    toolCalls: ToolCall[],
    results: { callId: string; output: string }[]
  ): ChatMessage[];
}

// ── OpenAI ────────────────────────────────────────────────

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
      messages: messages.map(toOpenAIMsg),
    });
    return resp.choices[0]?.message?.content || "";
  }

  async *stream(messages: ChatMessage[], model?: string): AsyncIterable<string> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const stream = await client.chat.completions.create({
      model: model || this.defaultModel,
      messages: messages.map(toOpenAIMsg),
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): Promise<AgentResponse> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const resp = await client.chat.completions.create({
      model: model || this.defaultModel,
      messages: messages.map(toOpenAIMsg),
      tools: toOpenAITools(tools) as any,
    });

    const msg = resp.choices[0]?.message;
    const toolCalls: ToolCall[] = [];

    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        toolCalls.push({ id: tc.id, name: tc.function.name, args });
      }
    }

    return { text: msg?.content || "", toolCalls };
  }

  buildToolResultMessages(
    toolCalls: ToolCall[],
    results: { callId: string; output: string }[]
  ): ChatMessage[] {
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
    };

    const resultMsgs: ChatMessage[] = results.map((r) => ({
      role: "tool" as const,
      content: r.output,
      toolCallId: r.callId,
    }));

    return [assistantMsg, ...resultMsgs];
  }
}

// ── Anthropic ─────────────────────────────────────────────

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
    const { system, msgs } = splitSystemAnthropic(messages);
    const resp = await client.messages.create({
      model: model || this.defaultModel,
      max_tokens: 4096,
      system,
      messages: msgs as any,
    });
    const tb = resp.content.find((b: any) => b.type === "text");
    return tb ? (tb as any).text : "";
  }

  async *stream(messages: ChatMessage[], model?: string): AsyncIterable<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const { system, msgs } = splitSystemAnthropic(messages);
    const stream = client.messages.stream({
      model: model || this.defaultModel,
      max_tokens: 4096,
      system,
      messages: msgs as any,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    model?: string
  ): Promise<AgentResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const { system, msgs } = splitSystemAnthropic(messages);
    const resp = await client.messages.create({
      model: model || this.defaultModel,
      max_tokens: 4096,
      system,
      messages: msgs as any,
      tools: toAnthropicTools(tools) as any,
    });

    const toolCalls: ToolCall[] = [];
    let text = "";

    for (const block of resp.content) {
      if ((block as any).type === "text") text = (block as any).text;
      if ((block as any).type === "tool_use") {
        toolCalls.push({
          id: (block as any).id,
          name: (block as any).name,
          args: (block as any).input || {},
        });
      }
    }

    return { text, toolCalls };
  }

  buildToolResultMessages(
    toolCalls: ToolCall[],
    results: { callId: string; output: string }[]
  ): ChatMessage[] {
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      })),
    };

    const userMsg: ChatMessage = {
      role: "user",
      content: "",
      toolResults: results.map((r) => ({
        callId: r.callId,
        output: r.output,
      })),
    };

    return [assistantMsg, userMsg];
  }
}

// ── Helpers ───────────────────────────────────────────────

function toOpenAIMsg(m: ChatMessage): any {
  if (m.toolCalls) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    };
  }
  if (m.role === "tool" && m.toolCallId) {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

function splitSystemAnthropic(messages: ChatMessage[]): {
  system: string;
  msgs: any[];
} {
  const sys = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  const msgs = rest.map((m) => {
    if (m.toolCalls) {
      return {
        role: "assistant",
        content: m.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        })),
      };
    }
    if (m.toolResults) {
      return {
        role: "user",
        content: m.toolResults.map((tr) => ({
          type: "tool_result",
          tool_use_id: tr.callId,
          content: tr.output,
        })),
      };
    }
    return { role: m.role, content: m.content };
  });

  return { system: sys?.content || "", msgs };
}

export function createProvider(
  provider: "openai" | "anthropic",
  apiKey: string,
  model?: string
): LLMProvider {
  if (provider === "anthropic") return new AnthropicProvider(apiKey, model);
  return new OpenAIProvider(apiKey, model);
}
