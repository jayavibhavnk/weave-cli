import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { MemoryFabric } from "../core/fabric.js";
import type { AgentMemory } from "../core/agent.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ChatMessage, RetrievalResult } from "../core/types.js";
import { generateId } from "../core/types.js";
import { colors, icons, getThinkingVerb } from "./theme.js";
import { findCommand, getCompletions, type CommandContext } from "./commands.js";

// ── Transcript Item Types ─────────────────────────────────

export type TranscriptItem =
  | { id: string; type: "user"; content: string }
  | { id: string; type: "assistant"; content: string; agentName: string }
  | { id: string; type: "memory-recall"; memories: { score: number; content: string }[] }
  | { id: string; type: "memory-added"; content: string }
  | { id: string; type: "system"; content: string }
  | { id: string; type: "error"; content: string }
  | { id: string; type: "divider" };

type StreamPhase = "idle" | "recalling" | "thinking" | "streaming";

interface AppProps {
  fabric: MemoryFabric;
  initialAgent: AgentMemory;
  provider: LLMProvider;
  model?: string;
  version: string;
}

// ── Gutter Layout ─────────────────────────────────────────

function Gutter({ icon, color, children }: {
  icon: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Box width={3} flexShrink={0}>
        <Text color={color}>{icon} </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}

function ContinuationLine({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <Box>
      <Box width={3} flexShrink={0}>
        <Text color={color || colors.dimmed}>{icons.pipe} </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}

// ── Message Components ────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.user}>
        <Text color={colors.user} bold>you</Text>
      </Gutter>
      <ContinueLine text={content} color={colors.dimmed} />
    </Box>
  );
}

function AssistantMessage({ content, agentName }: { content: string; agentName: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.agent}>
        <Text color={colors.agent} bold>{agentName}</Text>
      </Gutter>
      <ContinueLines text={content} color={colors.dimmed} />
    </Box>
  );
}

function MemoryRecallBlock({ memories }: { memories: { score: number; content: string }[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.diamond} color={colors.memory}>
        <Text color={colors.memory}>
          recalled {memories.length} {memories.length === 1 ? "memory" : "memories"}
        </Text>
      </Gutter>
      {memories.map((m, i) => (
        <ContinuationLine key={i} color={colors.memoryDim}>
          <Text dimColor>
            [{m.score.toFixed(2)}] {m.content.length > 72 ? m.content.substring(0, 72) + icons.ellipsis : m.content}
          </Text>
        </ContinuationLine>
      ))}
    </Box>
  );
}

function MemoryAddedBlock({ content }: { content: string }) {
  const short = content.length > 60 ? content.substring(0, 60) + icons.ellipsis : content;
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={colors.success}>{icons.plus} </Text>
      </Box>
      <Text dimColor>remembered: </Text>
      <Text dimColor italic>{short}</Text>
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.brain} color={colors.accent}>
        <Box flexDirection="column">
          {content.split("\n").map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      </Gutter>
    </Box>
  );
}

function ErrorMessage({ content }: { content: string }) {
  return (
    <Box marginBottom={1}>
      <Gutter icon={icons.cross} color={colors.error}>
        <Text color={colors.error}>{content}</Text>
      </Gutter>
    </Box>
  );
}

function DividerLine() {
  return (
    <Box marginY={0}>
      <Text dimColor>{"  " + icons.dash.repeat(50)}</Text>
    </Box>
  );
}

// ── Helper to render multi-line content in the gutter ─────

function ContinueLine({ text, color }: { text: string; color: string }) {
  return (
    <ContinuationLine color={color}>
      <Text>{text}</Text>
    </ContinuationLine>
  );
}

function ContinueLines({ text, color }: { text: string; color: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <ContinuationLine key={i} color={color}>
          <Text wrap="wrap">{line}</Text>
        </ContinuationLine>
      ))}
    </>
  );
}

// ── Render a transcript item ──────────────────────────────

function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.type) {
    case "user":
      return <UserMessage content={item.content} />;
    case "assistant":
      return <AssistantMessage content={item.content} agentName={item.agentName} />;
    case "memory-recall":
      return <MemoryRecallBlock memories={item.memories} />;
    case "memory-added":
      return <MemoryAddedBlock content={item.content} />;
    case "system":
      return <SystemMessage content={item.content} />;
    case "error":
      return <ErrorMessage content={item.content} />;
    case "divider":
      return <DividerLine />;
    default:
      return null;
  }
}

// ── Streaming + Thinking Indicators ───────────────────────

function ThinkingIndicator({ agentName, verb }: { agentName: string; verb: string }) {
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={colors.agent}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text dimColor>
        <Text color={colors.agent}>{agentName}</Text> is {verb}{icons.ellipsis}
      </Text>
    </Box>
  );
}

function RecallingIndicator() {
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}>
        <Text color={colors.memory}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text dimColor>searching memories{icons.ellipsis}</Text>
    </Box>
  );
}

function StreamingResponse({ content, agentName }: { content: string; agentName: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.agent}>
        <Text color={colors.agent} bold>{agentName}</Text>
      </Gutter>
      <ContinueLines text={content + icons.cursor} color={colors.dimmed} />
    </Box>
  );
}

// ── Autocomplete Overlay ──────────────────────────────────

function SlashAutocomplete({ input }: { input: string }) {
  if (!input.startsWith("/") || input.includes(" ")) return null;
  const matches = getCompletions(input);
  if (matches.length === 0 || (matches.length === 1 && matches[0].name === input)) return null;

  return (
    <Box flexDirection="column" marginLeft={3} marginBottom={1}>
      {matches.slice(0, 6).map((cmd) => (
        <Box key={cmd.name} gap={1}>
          <Text color={colors.accent}>{cmd.name}</Text>
          <Text dimColor>{cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Banner Component ──────────────────────────────────────

function Banner({
  version,
  workspace,
  agentName,
  model,
  stats,
}: {
  version: string;
  workspace: string;
  agentName: string;
  model: string;
  stats: { nodes: number; edges: number };
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text> </Text>
      <Box gap={1} marginLeft={2}>
        <Text color={colors.brand}>{icons.weave}</Text>
        <Text color={colors.brand} bold>weave</Text>
        <Text dimColor>v{version}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>graph-native memory for AI agents</Text>
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text dimColor>{"─".repeat(50)}</Text>
      </Box>
      <Box marginLeft={2} gap={1}>
        <Text color={colors.label}>workspace</Text>
        <Text>{workspace}</Text>
        <Text dimColor>{icons.dot}</Text>
        <Text color={colors.label}>agent</Text>
        <Text color={colors.agent}>{agentName}</Text>
        <Text dimColor>{icons.dot}</Text>
        <Text dimColor>{model}</Text>
      </Box>
      <Box marginLeft={2} gap={1}>
        <Text color={colors.label}>memories</Text>
        <Text color={colors.memory}>{stats.nodes}</Text>
        <Text dimColor>nodes</Text>
        <Text dimColor>{icons.dot}</Text>
        <Text color={colors.memory}>{stats.edges}</Text>
        <Text dimColor>edges</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{"─".repeat(50)}</Text>
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text dimColor>Type a message to chat. </Text>
        <Text color={colors.accent}>/help</Text>
        <Text dimColor> for commands.</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}

// ── Status Bar ────────────────────────────────────────────

function StatusBar({ agentName, model, memoryCount }: {
  agentName: string;
  model: string;
  memoryCount: number;
}) {
  return (
    <Box marginLeft={2} gap={1}>
      <Text dimColor>{icons.dash.repeat(50)}</Text>
    </Box>
  );
}

// ── Input Prompt ──────────────────────────────────────────

function InputPrompt({ value, onChange, onSubmit, showAutocomplete }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  showAutocomplete: boolean;
}) {
  return (
    <Box flexDirection="column">
      {showAutocomplete && <SlashAutocomplete input={value} />}
      <Box>
        <Box width={3} flexShrink={0}>
          <Text color={colors.user}>{icons.prompt} </Text>
        </Box>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={(v) => {
            if (v.trim()) onSubmit(v.trim());
            onChange("");
          }}
          placeholder="Type a message..."
        />
      </Box>
    </Box>
  );
}

// ── Main App ──────────────────────────────────────────────

export default function App({ fabric, initialAgent, provider, model, version }: AppProps) {
  const { exit } = useApp();
  const [agent, setAgent] = useState(initialAgent);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [streamContent, setStreamContent] = useState("");
  const [thinkingVerb, setThinkingVerb] = useState("thinking");

  const agentName = agent.persona.name;
  const modelName = model || "gpt-4o";
  const stats = fabric.getStats();

  const pushItem = useCallback((item: TranscriptItem) => {
    setTranscript((prev) => [...prev, item]);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  const doExit = useCallback(() => {
    fabric.close();
    exit();
  }, [fabric, exit]);

  const commandContext: CommandContext = {
    fabric,
    agent,
    pushItem,
    setAgent,
    clearTranscript,
    exit: doExit,
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      doExit();
    }
  });

  const handleSubmit = useCallback(
    async (input: string) => {
      if (phase !== "idle") return;

      if (input.startsWith("/")) {
        const found = findCommand(input);
        if (found) {
          await found.cmd.handler(found.args, commandContext);
        } else {
          pushItem({
            id: generateId(),
            type: "error",
            content: `Unknown command: ${input.split(/\s/)[0]}. Type /help for commands.`,
          });
        }
        return;
      }

      pushItem({ id: generateId(), type: "user", content: input });
      agent.addChatMessage({ role: "user", content: input });

      setPhase("recalling");

      try {
        const recalled = await agent.recall(input, 5, "hybrid");
        if (recalled.length > 0) {
          pushItem({
            id: generateId(),
            type: "memory-recall",
            memories: recalled.map((r) => ({
              score: r.score,
              content: r.node.content,
            })),
          });
        }

        setThinkingVerb(getThinkingVerb());
        setPhase("thinking");

        const messages = buildMessages(agent, recalled, input);

        setPhase("streaming");
        setStreamContent("");

        let fullResponse = "";
        for await (const token of provider.stream(messages, model)) {
          fullResponse += token;
          setStreamContent(fullResponse);
        }

        agent.addChatMessage({ role: "assistant", content: fullResponse });
        pushItem({
          id: generateId(),
          type: "assistant",
          content: fullResponse,
          agentName: agent.persona.name,
        });

        const memContent = extractMemoryWorthy(input, fullResponse);
        if (memContent) {
          await agent.add(memContent);
          pushItem({ id: generateId(), type: "memory-added", content: memContent });
        }

        fabric.autoSave();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        pushItem({ id: generateId(), type: "error", content: errMsg });
      }

      setStreamContent("");
      setPhase("idle");
    },
    [phase, agent, provider, model, fabric, pushItem, commandContext]
  );

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "__banner__" }, ...transcript]}>
        {(item: TranscriptItem | { id: string }) => {
          if (item.id === "__banner__") {
            return (
              <Box key="__banner__">
                <Banner
                  version={version}
                  workspace="default"
                  agentName={agentName}
                  model={modelName}
                  stats={stats}
                />
              </Box>
            );
          }
          return (
            <Box key={item.id}>
              <TranscriptEntry item={item as TranscriptItem} />
            </Box>
          );
        }}
      </Static>

      {phase === "recalling" && <RecallingIndicator />}
      {phase === "thinking" && <ThinkingIndicator agentName={agentName} verb={thinkingVerb} />}
      {phase === "streaming" && (
        <StreamingResponse content={streamContent} agentName={agentName} />
      )}
      {phase === "idle" && (
        <InputPrompt
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          showAutocomplete={inputValue.startsWith("/")}
        />
      )}
    </Box>
  );
}

// ── Message Building ──────────────────────────────────────

function buildMessages(
  agent: AgentMemory,
  recalled: RetrievalResult[],
  currentInput: string
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = agent.buildSystemPrompt();
  if (recalled.length > 0) {
    systemPrompt +=
      "\n\n## Recalled Context (relevant to the current query)\n" +
      recalled
        .map((r, i) => `[Memory ${i + 1}, relevance=${r.score.toFixed(2)}] ${r.node.content}`)
        .join("\n");
  }
  messages.push({ role: "system", content: systemPrompt });

  const history = agent.getChatHistory(20);
  for (const msg of history.slice(0, -1)) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: "user", content: currentInput });
  return messages;
}

// ── Memory Extraction ─────────────────────────────────────

function extractMemoryWorthy(userInput: string, _response: string): string | null {
  const patterns = [
    /(?:my name is|i'm|i am)\s+(.+)/i,
    /(?:i work at|i'm at|employed at)\s+(.+)/i,
    /(?:i prefer|i like|i enjoy|i use)\s+(.+)/i,
    /(?:i live in|i'm from|i'm based in)\s+(.+)/i,
    /(?:remember that|don't forget|note that|fyi)\s+(.+)/i,
    /(?:the (?:deadline|due date|timeline) (?:is|for))\s+(.+)/i,
    /(?:(?:we|i) decided|the plan is|going forward)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(userInput)) {
      return userInput.length > 120 ? userInput.substring(0, 120) : userInput;
    }
  }

  if (userInput.length > 30 && /[.!]/.test(userInput)) {
    if (/\b(is|are|was|were|has|have|will|does|did)\b/i.test(userInput)) {
      return userInput.length > 120 ? userInput.substring(0, 120) : userInput;
    }
  }

  return null;
}
