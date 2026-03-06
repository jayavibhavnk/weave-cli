import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryFabric } from "../core/fabric.js";
import type { AgentMemory } from "../core/agent.js";
import type { LLMProvider } from "../llm/provider.js";
import type { TranscriptItem } from "./app.js";
import { generateId, MemoryType, MemoryTier } from "../core/types.js";
import { createProvider } from "../llm/provider.js";
import { resolveApiKey, loadConfig } from "../config.js";

export interface CommandContext {
  fabric: MemoryFabric;
  agent: AgentMemory;
  pushItem: (item: TranscriptItem) => void;
  setAgent: (agent: AgentMemory) => void;
  clearTranscript: () => void;
  exit: () => void;
  setModel: (model: string) => void;
  setProvider: (provider: LLMProvider) => void;
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
        .map((c) => `  ${c.name.padEnd(20)} ${c.description}`)
        .join("\n");
      ctx.pushItem({ id: generateId(), type: "system", content: `Commands\n${"─".repeat(44)}\n${lines}` });
    },
  },

  // ── /init — scan codebase and seed memory ─────────────
  {
    name: "/init",
    description: "Scan codebase and seed agent memory",
    handler: async (args, ctx) => {
      const cwd = process.cwd();
      const scanned: string[] = [];

      const pkgPath = path.join(cwd, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const facts: string[] = [];
          if (pkg.name) facts.push(`Project name: ${pkg.name}`);
          if (pkg.description) facts.push(`Description: ${pkg.description}`);
          if (pkg.dependencies) facts.push(`Dependencies: ${Object.keys(pkg.dependencies).join(", ")}`);
          if (pkg.scripts) facts.push(`Scripts: ${Object.keys(pkg.scripts).join(", ")}`);
          const content = facts.join(". ");
          await ctx.agent.add(content, { type: MemoryType.SEMANTIC, importance: 0.8 });
          scanned.push("package.json");
        } catch {}
      }

      const readmePath = path.join(cwd, "README.md");
      if (fs.existsSync(readmePath)) {
        try {
          let readme = fs.readFileSync(readmePath, "utf-8");
          if (readme.length > 500) readme = readme.substring(0, 500) + "...";
          await ctx.agent.add(`README summary: ${readme}`, { type: MemoryType.SEMANTIC, importance: 0.7 });
          scanned.push("README.md");
        } catch {}
      }

      const weavePath = path.join(cwd, "WEAVE.md");
      if (fs.existsSync(weavePath)) {
        try {
          let content = fs.readFileSync(weavePath, "utf-8");
          if (content.length > 500) content = content.substring(0, 500) + "...";
          await ctx.agent.add(`Project context (WEAVE.md): ${content}`, { type: MemoryType.SEMANTIC, importance: 0.9 });
          scanned.push("WEAVE.md");
        } catch {}
      }

      try {
        const entries = fs.readdirSync(cwd, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist");
        const files = entries.filter((e) => e.isFile()).map((e) => e.name);
        const structure = `Project structure: directories=[${dirs.map((d) => d.name).join(", ")}], root files=[${files.slice(0, 15).join(", ")}]`;
        await ctx.agent.add(structure, { type: MemoryType.SEMANTIC, importance: 0.6 });
        scanned.push("directory structure");
      } catch {}

      const tsconfig = path.join(cwd, "tsconfig.json");
      if (fs.existsSync(tsconfig)) {
        await ctx.agent.add("Project uses TypeScript", { type: MemoryType.SEMANTIC, importance: 0.5 });
        scanned.push("tsconfig.json");
      }
      const pyproject = path.join(cwd, "pyproject.toml");
      if (fs.existsSync(pyproject)) {
        await ctx.agent.add("Project uses Python", { type: MemoryType.SEMANTIC, importance: 0.5 });
        scanned.push("pyproject.toml");
      }

      ctx.fabric.save();
      ctx.pushItem({
        id: generateId(), type: "system",
        content: scanned.length > 0
          ? `Codebase scanned: ${scanned.join(", ")}.\n${scanned.length} sources added to memory.`
          : "No recognizable project files found in current directory.",
      });
    },
  },

  // ── /remember — add explicit memory ───────────────────
  {
    name: "/remember",
    description: "Save something to memory",
    handler: async (content, ctx) => {
      if (!content) {
        ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /remember <what to remember>" });
        return;
      }
      await ctx.agent.add(content, { importance: 0.85, tier: MemoryTier.LONG_TERM });
      ctx.fabric.save();
      ctx.pushItem({ id: generateId(), type: "memory-added", content });
    },
  },

  // ── /forget — remove memories by search ───────────────
  {
    name: "/forget",
    description: "Forget memories matching a query",
    handler: async (query, ctx) => {
      if (!query) {
        ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /forget <query>" });
        return;
      }
      const results = await ctx.agent.recall(query, 3);
      let removed = 0;
      for (const r of results) {
        if (r.score > 0.3) {
          ctx.agent.forget(r.node.id);
          removed++;
        }
      }
      ctx.fabric.save();
      ctx.pushItem({
        id: generateId(), type: "system",
        content: removed > 0 ? `Forgot ${removed} memor${removed === 1 ? "y" : "ies"} matching "${query}".` : `No strong matches found for "${query}".`,
      });
    },
  },

  // ── /model — switch model mid-chat ────────────────────
  {
    name: "/model",
    description: "Switch LLM model",
    handler: (modelName, ctx) => {
      if (!modelName) {
        ctx.pushItem({
          id: generateId(), type: "system",
          content: "Usage: /model <model-name>\nExamples: gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514, claude-opus-4-20250514",
        });
        return;
      }

      const config = loadConfig();
      let providerName = config.provider;
      if (modelName.startsWith("claude")) providerName = "anthropic";
      else if (modelName.startsWith("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")) providerName = "openai";

      const apiKey = resolveApiKey({ ...config, provider: providerName });
      if (!apiKey) {
        ctx.pushItem({ id: generateId(), type: "error", content: `No API key for ${providerName}. Run: weave config set apiKey <key>` });
        return;
      }

      const newProvider = createProvider(providerName, apiKey, modelName);
      ctx.setProvider(newProvider);
      ctx.setModel(modelName);
      ctx.pushItem({ id: generateId(), type: "system", content: `Switched to ${modelName} (${providerName})` });
    },
  },

  // ── Standard commands ─────────────────────────────────
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
      if (!query) { ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /recall <query>" }); return; }
      const results = await ctx.agent.recall(query, 10);
      if (results.length === 0) { ctx.pushItem({ id: generateId(), type: "system", content: "No memories found." }); return; }
      const lines = results.map((r) => `[${r.score.toFixed(3)}] ${r.node.content}`).join("\n");
      ctx.pushItem({ id: generateId(), type: "system", content: `Search Results (${results.length})\n${lines}` });
    },
  },
  {
    name: "/agents",
    description: "List all agents",
    handler: (_args, ctx) => {
      const agents = ctx.fabric.listAgents();
      const lines = agents.map((a) => {
        const stats = a.getMemoryStats();
        const active = a.id === ctx.agent.id ? " (active)" : "";
        return `${a.persona.name}${active} — ${a.persona.role} — ${stats.total} memories`;
      }).join("\n");
      ctx.pushItem({ id: generateId(), type: "system", content: `Agents\n${lines || "(none)"}` });
    },
  },
  {
    name: "/switch",
    description: "Switch agent",
    handler: (name, ctx) => {
      if (!name) { ctx.pushItem({ id: generateId(), type: "error", content: "Usage: /switch <agent>" }); return; }
      const target = ctx.fabric.getAgent(name);
      if (!target) { ctx.pushItem({ id: generateId(), type: "error", content: `Agent "${name}" not found.` }); return; }
      ctx.setAgent(target);
      ctx.pushItem({ id: generateId(), type: "system", content: `Switched to ${target.persona.name}` });
    },
  },
  {
    name: "/stats",
    description: "Memory statistics",
    handler: (_args, ctx) => {
      const s = ctx.agent.getMemoryStats();
      const f = ctx.fabric.getStats();
      ctx.pushItem({ id: generateId(), type: "system",
        content: `Memory Stats\nWorking: ${s.working}  STM: ${s.shortTerm}  LTM: ${s.longTerm}  Archival: ${s.archival}\nTotal: ${f.nodes} nodes, ${f.edges} edges, ${f.agents} agents`,
      });
    },
  },
  {
    name: "/compact",
    description: "Run memory consolidation",
    handler: (_args, ctx) => {
      const r = ctx.agent.consolidate();
      ctx.pushItem({ id: generateId(), type: "system",
        content: `Consolidation: promoted ${r.promoted}, merged ${r.merged}, decayed ${r.decayed}, pruned ${r.pruned}`,
      });
    },
  },
  { name: "/save", description: "Force save", handler: (_a, ctx) => { ctx.fabric.save(); ctx.pushItem({ id: generateId(), type: "system", content: "Saved." }); } },
  { name: "/clear", description: "Clear chat (memories persist)", handler: (_a, ctx) => { ctx.agent.clearChatHistory(); ctx.clearTranscript(); } },
  { name: "/exit", description: "Exit weave", handler: (_a, ctx) => ctx.exit() },
  { name: "/quit", description: "Exit weave", hidden: true, handler: (_a, ctx) => ctx.exit() },
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
