import type { LLMProvider } from "../llm/provider.js";
import type { AgentMemory } from "../core/agent.js";
import { MemoryType } from "../core/types.js";
import type { AutonomousPlanItem, TestCommand, TestCommandKind, TestingPlan } from "./types.js";

const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^npm run (test|lint|build|typecheck|check-types|integration|e2e)(\s|$)/i,
  /^pnpm run (test|lint|build|typecheck|check-types|integration|e2e)(\s|$)/i,
  /^yarn (test|lint|build|typecheck|check-types|integration|e2e)(\s|$)/i,
  /^python -m pytest(\s|$)/i,
  /^go test(\s|$)/i,
  /^cargo test(\s|$)/i,
];

function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (trimmed.includes("&&") || trimmed.includes(";") || trimmed.includes("|")) return false;
  if (/\b(--watch|-w|watch)\b/i.test(trimmed)) return false;
  if (/--\s+[^\-\s][^\s]*/.test(trimmed)) return false;
  if (/\s+[^\s]+\.(js|ts|tsx|jsx)\b/i.test(trimmed)) return false;
  return SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isDerivedFromDiscoveredCommand(command: string, discovered: TestCommand[]): boolean {
  const trimmed = command.trim();
  for (const base of discovered.map((d) => d.command.trim())) {
    if (trimmed === base) return true;
    if (trimmed.startsWith(base + " ")) return true;
  }
  return false;
}

function normalizeKind(kind?: string): TestCommandKind {
  const k = (kind || "").toLowerCase();
  if (k === "lint" || k === "typecheck" || k === "unit" || k === "integration" || k === "e2e" || k === "build") {
    return k;
  }
  return "custom";
}

function parsePlanItems(text: string): AutonomousPlanItem[] {
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first === -1 || last === -1 || last <= first) return [];
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): AutonomousPlanItem | null => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        if (typeof obj.command !== "string" || typeof obj.label !== "string") return null;
        return {
          command: obj.command,
          label: obj.label,
          rationale: typeof obj.rationale === "string" ? obj.rationale : "Autonomous test expansion",
          kind: normalizeKind(typeof obj.kind === "string" ? obj.kind : undefined),
        };
      })
      .filter((x): x is AutonomousPlanItem => Boolean(x));
  } catch {
    return [];
  }
}

export async function generateAutonomousPlan(
  provider: LLMProvider | null,
  model: string,
  plan: TestingPlan,
  maxItems: number
): Promise<AutonomousPlanItem[]> {
  if (!provider) return [];
  const discovered = plan.commands.map((c) => `${c.label} => ${c.command}`).join("\n");
  const prompt = [
    "You are an autonomous QA planner.",
    `Project runtime=${plan.runtime}, packageManager=${plan.packageManager}.`,
    "Given discovered commands, propose extra test commands to improve confidence and edge-case coverage.",
    "Output JSON array only. Max items: " + maxItems + ".",
    "Each item shape: {\"label\": string, \"command\": string, \"rationale\": string, \"kind\": \"unit|integration|e2e|lint|typecheck|build|custom\"}.",
    "Only produce commands from this safe family: npm/pnpm/yarn test-like scripts, pytest, go test, cargo test.",
    "Commands must be derived from discovered commands by appending flags/args only (for example: `npm run test -- --coverage`).",
    "Do not use shell chaining, pipes, or destructive commands.",
    "",
    "Discovered commands:",
    discovered || "(none)",
  ].join("\n");

  try {
    const response = await provider.chat(
      [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: prompt },
      ],
      model
    );
    return parsePlanItems(response)
      .filter((item) => isSafeCommand(item.command))
      .filter((item) => isDerivedFromDiscoveredCommand(item.command, plan.commands))
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

export function toAutonomousCommands(items: AutonomousPlanItem[], existing: TestCommand[]): TestCommand[] {
  const seen = new Set(existing.map((c) => c.command.trim()));
  const out: TestCommand[] = [];
  let idx = 0;
  for (const item of items) {
    const key = item.command.trim();
    if (!key || seen.has(key) || !isSafeCommand(key)) continue;
    if (!isDerivedFromDiscoveredCommand(key, existing)) continue;
    seen.add(key);
    out.push({
      id: `auto-${idx++}`,
      kind: item.kind || "custom",
      label: item.label,
      command: item.command,
      required: false,
      source: "autonomous",
      rationale: item.rationale,
    });
  }
  return out;
}

export async function persistAutonomousPlan(
  planner: AgentMemory,
  edgeHunter: AgentMemory,
  items: AutonomousPlanItem[]
): Promise<void> {
  if (items.length === 0) return;
  const summary = items
    .map((i) => `${i.label}: ${i.command}`)
    .slice(0, 12)
    .join(" | ");
  await planner.add(`Autonomous test plan generated: ${summary}`, {
    importance: 0.78,
    type: MemoryType.PROCEDURAL,
  });
  for (const item of items.slice(0, 12)) {
    await edgeHunter.add(`Edge-case execution idea: ${item.label} -> ${item.rationale}`, {
      importance: 0.72,
      type: MemoryType.SEMANTIC,
    });
  }
}
