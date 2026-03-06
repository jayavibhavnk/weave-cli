import type { MemoryFabric } from "../core/fabric.js";
import type { AgentMemory } from "../core/agent.js";
import type { TranscriptItem } from "./app.js";
import { generateId } from "../core/types.js";
import { colors } from "./theme.js";

export interface CommandContext {
  fabric: MemoryFabric;
  agent: AgentMemory;
  pushItem: (item: TranscriptItem) => void;
  setAgent: (agent: AgentMemory) => void;
  clearTranscript: () => void;
  exit: () => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  hidden?: boolean;
  handler: (args: string, ctx: CommandContext) => Promise<void> | void;
}

export const commands: SlashCommand[] = [
  {
    name: "/help",
    description: "Show available commands",
    handler: (_args, ctx) => {
      const lines = commands
        .filter((c) => !c.hidden)
        .map((c) => `  ${c.name.padEnd(18)} ${c.description}`)
        .join("\n");
      ctx.pushItem({
        id: generateId(),
        type: "system",
        content: `Commands\n${"─".repeat(44)}\n${lines}`,
      });
    },
  },
  {
    name: "/memory",
    description: "Show working memory",
    handler: (_args, ctx) => {
      const wm = ctx.agent.getWorkingMemory();
      if (wm.length === 0) {
        ctx.pushItem({ id: generateId(), type: "system", content: "No working memory loaded." });
        return;
      }
      const lines = wm.map((n) => `[${n.importance.toFixed(2)}] ${n.content}`).join("\n");
      ctx.pushItem({ id: generateId(), type: "system", content: `Working Memory\n${lines}` });
    },
  },
  {
    name: "/recall",
    description: "Search memories",
    handler: async (query, ctx) => {
      if (!query) {
        ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /recall <query>" });
        return;
      }
      const results = await ctx.agent.recall(query, 10);
      if (results.length === 0) {
        ctx.pushItem({ id: generateId(), type: "system", content: "No memories found." });
        return;
      }
      const lines = results
        .map((r) => `[${r.score.toFixed(3)}] ${r.node.content}`)
        .join("\n");
      ctx.pushItem({
        id: generateId(),
        type: "system",
        content: `Search Results (${results.length})\n${lines}`,
      });
    },
  },
  {
    name: "/agents",
    description: "List all agents",
    handler: (_args, ctx) => {
      const agents = ctx.fabric.listAgents();
      if (agents.length === 0) {
        ctx.pushItem({ id: generateId(), type: "system", content: "No agents." });
        return;
      }
      const lines = agents
        .map((a) => {
          const stats = a.getMemoryStats();
          const active = a.id === ctx.agent.id ? " (active)" : "";
          return `${a.persona.name}${active} — ${a.persona.role} — ${stats.total} memories`;
        })
        .join("\n");
      ctx.pushItem({ id: generateId(), type: "system", content: `Agents\n${lines}` });
    },
  },
  {
    name: "/switch",
    description: "Switch agent",
    handler: (name, ctx) => {
      if (!name) {
        ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /switch <agent-name>" });
        return;
      }
      const target = ctx.fabric.getAgent(name);
      if (!target) {
        ctx.pushItem({ id: generateId(), type: "error", content: `Agent "${name}" not found.` });
        return;
      }
      ctx.setAgent(target);
      ctx.pushItem({
        id: generateId(),
        type: "system",
        content: `Switched to ${target.persona.name} (${target.persona.role})`,
      });
    },
  },
  {
    name: "/stats",
    description: "Memory statistics",
    handler: (_args, ctx) => {
      const stats = ctx.agent.getMemoryStats();
      const fStats = ctx.fabric.getStats();
      ctx.pushItem({
        id: generateId(),
        type: "system",
        content: [
          `Memory Stats`,
          `Working: ${stats.working}  Short-term: ${stats.shortTerm}  Long-term: ${stats.longTerm}  Archival: ${stats.archival}`,
          `Total: ${fStats.nodes} nodes, ${fStats.edges} edges, ${fStats.agents} agents`,
        ].join("\n"),
      });
    },
  },
  {
    name: "/compact",
    description: "Run memory consolidation",
    handler: (_args, ctx) => {
      const result = ctx.agent.consolidate();
      ctx.pushItem({
        id: generateId(),
        type: "system",
        content: `Consolidation: promoted ${result.promoted}, merged ${result.merged}, decayed ${result.decayed}, pruned ${result.pruned}`,
      });
    },
  },
  {
    name: "/save",
    description: "Force save workspace",
    handler: (_args, ctx) => {
      ctx.fabric.save();
      ctx.pushItem({ id: generateId(), type: "system", content: "Workspace saved." });
    },
  },
  {
    name: "/clear",
    description: "Clear chat (memories persist)",
    handler: (_args, ctx) => {
      ctx.agent.clearChatHistory();
      ctx.clearTranscript();
    },
  },
  {
    name: "/exit",
    description: "Exit weave",
    handler: (_args, ctx) => {
      ctx.exit();
    },
  },
  {
    name: "/quit",
    description: "Exit weave",
    hidden: true,
    handler: (_args, ctx) => {
      ctx.exit();
    },
  },
];

export function findCommand(input: string): { cmd: SlashCommand; args: string } | null {
  const parts = input.trim().split(/\s+/);
  const name = parts[0]?.toLowerCase();
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) return null;
  return { cmd, args: parts.slice(1).join(" ") };
}

export function getCompletions(partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return commands.filter((c) => !c.hidden && c.name.startsWith(lower));
}
