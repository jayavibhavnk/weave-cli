import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { MemoryFabric } from "../core/fabric.js";
import type { AgentMemory } from "../core/agent.js";
import type { LLMProvider, ToolCall } from "../llm/provider.js";
import type { ChatMessage, RetrievalResult } from "../core/types.js";
import { generateId } from "../core/types.js";
import { colors, icons, getThinkingVerb } from "./theme.js";
import { findCommand, type CommandContext } from "./commands.js";
import { builtinTools, type ToolDef } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";
import { MCPClient } from "../tools/mcp.js";
import { getCompletions } from "./commands.js";

// ── Transcript Item Types ─────────────────────────────────

export type TranscriptItem =
  | { id: string; type: "user"; content: string }
  | { id: string; type: "assistant"; content: string; agentName: string }
  | { id: string; type: "memory-recall"; memories: { score: number; content: string }[] }
  | { id: string; type: "memory-added"; content: string }
  | { id: string; type: "system"; content: string }
  | { id: string; type: "error"; content: string }
  | { id: string; type: "tool-call"; name: string; args: Record<string, unknown>; status: "running" | "done" | "denied" }
  | { id: string; type: "tool-result"; name: string; output: string; success: boolean }
  | { id: string; type: "divider" };

type StreamPhase = "idle" | "recalling" | "thinking" | "streaming" | "tool-running" | "awaiting-approval";

interface AppProps {
  fabric: MemoryFabric;
  initialAgent: AgentMemory;
  provider: LLMProvider;
  model?: string;
  version: string;
}

// ── Layout Components ─────────────────────────────────────

function Gutter({ icon, color, children }: { icon: string; color: string; children: React.ReactNode }) {
  return (
    <Box>
      <Box width={3} flexShrink={0}><Text color={color}>{icon} </Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{children}</Box>
    </Box>
  );
}

function ContLine({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <Box>
      <Box width={3} flexShrink={0}><Text color={color || colors.dimmed}>{icons.pipe} </Text></Box>
      <Box flexGrow={1} flexShrink={1}>{children}</Box>
    </Box>
  );
}

// ── Message Components ────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.user}><Text color={colors.user} bold>you</Text></Gutter>
      <ContLine><Text wrap="wrap">{content}</Text></ContLine>
    </Box>
  );
}

function AssistantMessage({ content, agentName }: { content: string; agentName: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.agent}><Text color={colors.agent} bold>{agentName}</Text></Gutter>
      {content.split("\n").map((line, i) => (
        <ContLine key={i}><Text wrap="wrap">{line}</Text></ContLine>
      ))}
    </Box>
  );
}

function MemoryRecallBlock({ memories }: { memories: { score: number; content: string }[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.diamond} color={colors.memory}>
        <Text color={colors.memory}>recalled {memories.length} {memories.length === 1 ? "memory" : "memories"}</Text>
      </Gutter>
      {memories.map((m, i) => (
        <ContLine key={i} color={colors.memoryDim}>
          <Text dimColor>[{m.score.toFixed(2)}] {m.content.length > 72 ? m.content.substring(0, 72) + icons.ellipsis : m.content}</Text>
        </ContLine>
      ))}
    </Box>
  );
}

function MemoryAddedBlock({ content }: { content: string }) {
  const short = content.length > 60 ? content.substring(0, 60) + icons.ellipsis : content;
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}><Text color={colors.success}>{icons.plus} </Text></Box>
      <Text dimColor>remembered: </Text><Text dimColor italic>{short}</Text>
    </Box>
  );
}

function ToolCallBlock({ name, args, status }: { name: string; args: Record<string, unknown>; status: string }) {
  const statusIcon = status === "running" ? "⠋" : status === "done" ? icons.check : icons.cross;
  const statusColor = status === "running" ? colors.warning : status === "done" ? colors.success : colors.error;
  const argsStr = Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === "string" ? (v.length > 50 ? v.substring(0, 50) + "..." : v) : JSON.stringify(v);
      return `${k}=${val}`;
    })
    .join(" ");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.weave} color={colors.accent}>
        <Box gap={1}>
          <Text color={statusColor}>{statusIcon}</Text>
          <Text color={colors.accent} bold>{name}</Text>
          <Text dimColor>{argsStr}</Text>
        </Box>
      </Gutter>
    </Box>
  );
}

function ToolResultBlock({ name, output, success }: { name: string; output: string; success: boolean }) {
  const lines = output.split("\n");
  const display = lines.length > 8 ? lines.slice(0, 8) : lines;
  const truncated = lines.length > 8;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {display.map((line, i) => (
        <ContLine key={i} color={success ? colors.memoryDim : colors.errorDim}>
          <Text dimColor wrap="wrap">{line}</Text>
        </ContLine>
      ))}
      {truncated && <ContLine><Text dimColor>... ({lines.length - 8} more lines)</Text></ContLine>}
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.brain} color={colors.accent}>
        <Box flexDirection="column">
          {content.split("\n").map((line, i) => <Text key={i} dimColor>{line}</Text>)}
        </Box>
      </Gutter>
    </Box>
  );
}

function ErrorMessage({ content }: { content: string }) {
  return (
    <Box marginBottom={1}>
      <Gutter icon={icons.cross} color={colors.error}><Text color={colors.error}>{content}</Text></Gutter>
    </Box>
  );
}

// ── Transcript Renderer ───────────────────────────────────

function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.type) {
    case "user": return <UserMessage content={item.content} />;
    case "assistant": return <AssistantMessage content={item.content} agentName={item.agentName} />;
    case "memory-recall": return <MemoryRecallBlock memories={item.memories} />;
    case "memory-added": return <MemoryAddedBlock content={item.content} />;
    case "tool-call": return <ToolCallBlock name={item.name} args={item.args} status={item.status} />;
    case "tool-result": return <ToolResultBlock name={item.name} output={item.output} success={item.success} />;
    case "system": return <SystemMessage content={item.content} />;
    case "error": return <ErrorMessage content={item.content} />;
    case "divider": return <Box marginY={0}><Text dimColor>{"  " + icons.dash.repeat(50)}</Text></Box>;
    default: return null;
  }
}

// ── Status Indicators ─────────────────────────────────────

function ThinkingIndicator({ agentName, verb }: { agentName: string; verb: string }) {
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}><Text color={colors.agent}><Spinner type="dots" /></Text></Box>
      <Text dimColor><Text color={colors.agent}>{agentName}</Text> is {verb}{icons.ellipsis}</Text>
    </Box>
  );
}

function RecallingIndicator() {
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}><Text color={colors.memory}><Spinner type="dots" /></Text></Box>
      <Text dimColor>searching memories{icons.ellipsis}</Text>
    </Box>
  );
}

function ToolRunningIndicator({ name }: { name: string }) {
  return (
    <Box marginBottom={1}>
      <Box width={3} flexShrink={0}><Text color={colors.accent}><Spinner type="dots" /></Text></Box>
      <Text dimColor>running <Text color={colors.accent}>{name}</Text>{icons.ellipsis}</Text>
    </Box>
  );
}

function StreamingResponse({ content, agentName }: { content: string; agentName: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon={icons.dot} color={colors.agent}><Text color={colors.agent} bold>{agentName}</Text></Gutter>
      {content.split("\n").map((line, i) => (
        <ContLine key={i}><Text wrap="wrap">{line}</Text></ContLine>
      ))}
      <ContLine><Text color={colors.dimmed}>{icons.cursor}</Text></ContLine>
    </Box>
  );
}

function ApprovalPrompt({ toolName, args }: { toolName: string; args: Record<string, unknown> }) {
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n    ");
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gutter icon="?" color={colors.warning}>
        <Text color={colors.warning} bold>Allow {toolName}?</Text>
      </Gutter>
      <ContLine color={colors.warning}><Text dimColor>{argsStr}</Text></ContLine>
      <ContLine color={colors.warning}>
        <Text>
          <Text color={colors.success} bold>[y]</Text><Text dimColor>es  </Text>
          <Text color={colors.error} bold>[n]</Text><Text dimColor>o  </Text>
          <Text color={colors.accent} bold>[a]</Text><Text dimColor>lways allow</Text>
        </Text>
      </ContLine>
    </Box>
  );
}

// ── Slash Autocomplete ────────────────────────────────────

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

// ── Banner ────────────────────────────────────────────────

function Banner({ version, agentName, model, stats }: {
  version: string; agentName: string; model: string;
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
      <Box marginLeft={2}><Text dimColor>graph-native memory for AI agents</Text></Box>
      <Text> </Text>
      <Box marginLeft={2}><Text dimColor>{"─".repeat(50)}</Text></Box>
      <Box marginLeft={2} gap={1}>
        <Text color={colors.label}>agent</Text>
        <Text color={colors.agent}>{agentName}</Text>
        <Text dimColor>{icons.dot}</Text>
        <Text dimColor>{model}</Text>
        <Text dimColor>{icons.dot}</Text>
        <Text color={colors.memory}>{stats.nodes}</Text>
        <Text dimColor>memories</Text>
      </Box>
      <Box marginLeft={2}><Text dimColor>{"─".repeat(50)}</Text></Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text dimColor>Type a message. </Text>
        <Text color={colors.accent}>/help</Text>
        <Text dimColor> for commands. Tools enabled.</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}

// ── Main App ──────────────────────────────────────────────

export default function App({ fabric, initialAgent, provider, model, version }: AppProps) {
  const { exit } = useApp();
  const [agent, setAgent] = useState(initialAgent);
  const [currentModel, setCurrentModel] = useState(model || "gpt-4o");
  const [currentProvider, setCurrentProvider] = useState(provider);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [streamContent, setStreamContent] = useState("");
  const [thinkingVerb, setThinkingVerb] = useState("thinking");
  const [pendingTool, setPendingTool] = useState<ToolCall | null>(null);
  const [runningToolName, setRunningToolName] = useState("");
  const [allTools, setAllTools] = useState<ToolDef[]>(builtinTools);
  const [autoApproved, setAutoApproved] = useState<Set<string>>(new Set());
  const approvalResolver = useRef<((v: "yes" | "no" | "always") => void) | null>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);

  const agentName = agent.persona.name;
  const stats = fabric.getStats();

  useEffect(() => {
    const mcp = new MCPClient();
    mcpClientRef.current = mcp;
    mcp.connectAll().then((mcpTools) => {
      if (mcpTools.length > 0) setAllTools([...builtinTools, ...mcpTools]);
    }).catch(() => {});
    return () => { mcp.close(); };
  }, []);

  const pushItem = useCallback((item: TranscriptItem) => {
    setTranscript((prev) => [...prev, item]);
  }, []);

  const clearTranscript = useCallback(() => setTranscript([]), []);

  const doExit = useCallback(() => {
    fabric.close();
    mcpClientRef.current?.close();
    exit();
  }, [fabric, exit]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") { doExit(); return; }
    if (phase === "awaiting-approval" && approvalResolver.current) {
      if (input === "y" || input === "Y") { approvalResolver.current("yes"); }
      else if (input === "n" || input === "N") { approvalResolver.current("no"); }
      else if (input === "a" || input === "A") { approvalResolver.current("always"); }
    }
  });

  const waitForApproval = useCallback((call: ToolCall): Promise<"yes" | "no" | "always"> => {
    return new Promise((resolve) => {
      setPendingTool(call);
      setPhase("awaiting-approval");
      approvalResolver.current = (v) => {
        approvalResolver.current = null;
        setPendingTool(null);
        resolve(v);
      };
    });
  }, []);

  const handleSubmit = useCallback(async (input: string) => {
    if (phase !== "idle") return;

    if (input.startsWith("/")) {
      const ctx: CommandContext = {
        fabric, agent, pushItem, setAgent, clearTranscript, exit: doExit,
        setModel: setCurrentModel, setProvider: setCurrentProvider,
      };
      const found = findCommand(input);
      if (found) await found.cmd.handler(found.args, ctx);
      else pushItem({ id: generateId(), type: "error", content: `Unknown command: ${input.split(/\s/)[0]}` });
      return;
    }

    pushItem({ id: generateId(), type: "user", content: input });
    agent.addChatMessage({ role: "user", content: input });

    setPhase("recalling");
    let recalled: RetrievalResult[] = [];
    try {
      recalled = await agent.recall(input, 5, "hybrid");
      if (recalled.length > 0) {
        pushItem({
          id: generateId(), type: "memory-recall",
          memories: recalled.map((r) => ({ score: r.score, content: r.node.content })),
        });
      }
    } catch {}

    const messages: ChatMessage[] = buildMessages(agent, recalled, input);

    try {
      // Agentic loop — keeps running until model returns text (no more tool calls)
      let iterations = 0;
      const MAX_ITERATIONS = 15;

      while (iterations++ < MAX_ITERATIONS) {
        setThinkingVerb(getThinkingVerb());
        setPhase("thinking");

        const response = await currentProvider.chatWithTools(messages, allTools, currentModel);

        if (response.toolCalls.length > 0) {
          const toolResults: { callId: string; output: string }[] = [];

          for (const call of response.toolCalls) {
            const toolDef = allTools.find((t) => t.name === call.name);
            const needsApproval = toolDef?.requiresApproval && !autoApproved.has(call.name);

            pushItem({ id: generateId(), type: "tool-call", name: call.name, args: call.args, status: "running" });

            if (needsApproval) {
              const decision = await waitForApproval(call);
              if (decision === "no") {
                pushItem({ id: generateId(), type: "tool-result", name: call.name, output: "User denied this action.", success: false });
                toolResults.push({ callId: call.id, output: "User denied this action." });
                continue;
              }
              if (decision === "always") {
                setAutoApproved((prev) => new Set([...prev, call.name]));
              }
            }

            setPhase("tool-running");
            setRunningToolName(call.name);

            let result: { success: boolean; output: string };
            if (mcpClientRef.current?.isMCPTool(call.name)) {
              const output = await mcpClientRef.current.callTool(call.name, call.args);
              result = { success: true, output };
            } else {
              result = executeTool(call.name, call.args);
            }

            pushItem({ id: generateId(), type: "tool-result", name: call.name, output: result.output, success: result.success });
            toolResults.push({ callId: call.id, output: result.output });
          }

          const toolMsgs = currentProvider.buildToolResultMessages(response.toolCalls, toolResults);
          messages.push(...toolMsgs);
          continue;
        }

        // No tool calls — stream the final text response
        if (response.text) {
          agent.addChatMessage({ role: "assistant", content: response.text });
          pushItem({ id: generateId(), type: "assistant", content: response.text, agentName: agent.persona.name });
        } else {
          // Model returned empty text — try streaming
          setPhase("streaming");
          setStreamContent("");
          let fullResponse = "";
          for await (const token of currentProvider.stream(messages, currentModel)) {
            fullResponse += token;
            setStreamContent(fullResponse);
          }
          agent.addChatMessage({ role: "assistant", content: fullResponse });
          pushItem({ id: generateId(), type: "assistant", content: fullResponse, agentName: agent.persona.name });
        }
        break;
      }

      const memContent = extractMemoryWorthy(input);
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
  }, [phase, agent, currentProvider, currentModel, fabric, pushItem, allTools, autoApproved, waitForApproval, doExit, clearTranscript]);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "__banner__" }, ...transcript]}>
        {(item: TranscriptItem | { id: string }) => {
          if (item.id === "__banner__") {
            return <Box key="__banner__"><Banner version={version} agentName={agentName} model={currentModel} stats={stats} /></Box>;
          }
          return <Box key={item.id}><TranscriptEntry item={item as TranscriptItem} /></Box>;
        }}
      </Static>

      {phase === "recalling" && <RecallingIndicator />}
      {phase === "thinking" && <ThinkingIndicator agentName={agentName} verb={thinkingVerb} />}
      {phase === "tool-running" && <ToolRunningIndicator name={runningToolName} />}
      {phase === "streaming" && <StreamingResponse content={streamContent} agentName={agentName} />}
      {phase === "awaiting-approval" && pendingTool && (
        <ApprovalPrompt toolName={pendingTool.name} args={pendingTool.args} />
      )}
      {phase === "idle" && (
        <Box flexDirection="column">
          {inputValue.startsWith("/") && <SlashAutocomplete input={inputValue} />}
          <Box>
            <Box width={3} flexShrink={0}><Text color={colors.user}>{icons.prompt} </Text></Box>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(v) => { if (v.trim()) handleSubmit(v.trim()); setInputValue(""); }}
              placeholder="Type a message..."
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Helpers ───────────────────────────────────────────────

function buildMessages(agent: AgentMemory, recalled: RetrievalResult[], currentInput: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let systemPrompt = agent.buildSystemPrompt();
  if (recalled.length > 0) {
    systemPrompt += "\n\n## Recalled Context\n" +
      recalled.map((r, i) => `[Memory ${i + 1}, relevance=${r.score.toFixed(2)}] ${r.node.content}`).join("\n");
  }
  messages.push({ role: "system", content: systemPrompt });
  const history = agent.getChatHistory(20);
  for (const msg of history.slice(0, -1)) messages.push({ role: msg.role, content: msg.content });
  messages.push({ role: "user", content: currentInput });
  return messages;
}

function extractMemoryWorthy(userInput: string): string | null {
  const patterns = [
    /(?:my name is|i'm|i am)\s+(.+)/i, /(?:i work at|i'm at|employed at)\s+(.+)/i,
    /(?:i prefer|i like|i enjoy|i use)\s+(.+)/i, /(?:remember that|don't forget|note that|fyi)\s+(.+)/i,
    /(?:the (?:deadline|due date) (?:is|for))\s+(.+)/i, /(?:(?:we|i) decided|the plan is)\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(userInput)) return userInput.length > 120 ? userInput.substring(0, 120) : userInput;
  }
  if (userInput.length > 30 && /[.!]/.test(userInput) && /\b(is|are|was|were|has|have)\b/i.test(userInput)) {
    return userInput.length > 120 ? userInput.substring(0, 120) : userInput;
  }
  return null;
}
