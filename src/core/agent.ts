import {
  type MemoryNode,
  type AgentPersona,
  type RetrievalResult,
  type ConsolidationResult,
  type ChatMessage,
  MemoryTier,
  MemoryScope,
  MemoryType,
  createMemoryNode,
} from "./types.js";
import type { MemoryGraph } from "./graph.js";

const ENTITY_PATTERNS = [
  /(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  /(?:works? at|employed at|joined)\s+([A-Z][\w]+(?:\s+[A-Z][\w]+)*)/gi,
  /(?:using|use|with)\s+([\w]+(?:\.js|\.py|\.ts)?)/gi,
  /(?:deadline|due|by)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:,?\s+\d{4})?)/gi,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
];

function extractEntities(text: string): string[] {
  const entities = new Set<string>();
  for (const pattern of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const entity = match[1]?.trim();
      if (entity && entity.length > 1 && entity.length < 50) {
        entities.add(entity.toLowerCase());
      }
    }
  }
  return Array.from(entities);
}

export class AgentMemory {
  readonly id: string;
  persona: AgentPersona;
  private graph: MemoryGraph;
  private workingMemory: MemoryNode[] = [];
  private chatHistory: ChatMessage[] = [];
  private maxWorking = 20;

  constructor(id: string, persona: AgentPersona, graph: MemoryGraph) {
    this.id = id;
    this.persona = persona;
    this.graph = graph;
  }

  async add(
    content: string,
    opts: {
      type?: MemoryType;
      tier?: MemoryTier;
      scope?: MemoryScope;
      importance?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const entities = extractEntities(content);
    const node = createMemoryNode(content, this.id, {
      memoryType: opts.type || detectMemoryType(content),
      tier: opts.tier || MemoryTier.SHORT_TERM,
      scope: opts.scope || MemoryScope.PRIVATE,
      importance: opts.importance ?? estimateImportance(content),
      entities,
      metadata: opts.metadata || {},
    });

    await this.graph.addNode(node);

    if (node.tier === MemoryTier.WORKING) {
      this.workingMemory.push(node);
      if (this.workingMemory.length > this.maxWorking) {
        this.workingMemory.shift();
      }
    }

    return node.id;
  }

  async recall(
    query: string,
    k = 5,
    strategy: "vector" | "graph" | "hybrid" = "hybrid"
  ): Promise<RetrievalResult[]> {
    return this.graph.retrieve(query, k, {
      agentFilter: this.id,
      strategy,
    });
  }

  async recallContext(query: string, k = 5): Promise<string> {
    const results = await this.recall(query, k);
    if (results.length === 0) return "";

    return results
      .map(
        (r, i) => `[Memory ${i + 1}, relevance=${r.score.toFixed(2)}] ${r.node.content}`
      )
      .join("\n");
  }

  async loadToWorking(query: string, k = 5): Promise<MemoryNode[]> {
    const results = await this.recall(query, k);
    for (const r of results) {
      if (!this.workingMemory.some((n) => n.id === r.node.id)) {
        r.node.tier = MemoryTier.WORKING;
        this.workingMemory.push(r.node);
      }
    }
    while (this.workingMemory.length > this.maxWorking) {
      const evicted = this.workingMemory.shift()!;
      evicted.tier = MemoryTier.SHORT_TERM;
    }
    return this.workingMemory;
  }

  getWorkingMemory(): MemoryNode[] {
    return [...this.workingMemory];
  }

  getWorkingMemoryText(): string {
    if (this.workingMemory.length === 0) return "No active working memory.";
    return this.workingMemory.map((n) => `- ${n.content}`).join("\n");
  }

  addChatMessage(msg: ChatMessage): void {
    this.chatHistory.push({ ...msg, timestamp: msg.timestamp || Date.now() });
  }

  getChatHistory(limit?: number): ChatMessage[] {
    if (limit) return this.chatHistory.slice(-limit);
    return [...this.chatHistory];
  }

  clearChatHistory(): void {
    this.chatHistory = [];
  }

  getMemoryStats(): {
    total: number;
    working: number;
    shortTerm: number;
    longTerm: number;
    archival: number;
  } {
    const nodes = this.graph.getAgentNodes(this.id);
    return {
      total: nodes.length,
      working: this.workingMemory.length,
      shortTerm: nodes.filter((n) => n.tier === MemoryTier.SHORT_TERM).length,
      longTerm: nodes.filter((n) => n.tier === MemoryTier.LONG_TERM).length,
      archival: nodes.filter((n) => n.tier === MemoryTier.ARCHIVAL).length,
    };
  }

  forget(nodeId: string): boolean {
    this.workingMemory = this.workingMemory.filter((n) => n.id !== nodeId);
    return this.graph.removeNode(nodeId);
  }

  consolidate(): ConsolidationResult {
    return this.graph.consolidate();
  }

  buildSystemPrompt(): string {
    const p = this.persona;
    const parts: string[] = [];

    if (p.systemPrompt) {
      parts.push(p.systemPrompt);
    } else {
      parts.push(`You are ${p.name}, ${p.role}.`);
      if (p.description) parts.push(p.description);
    }

    parts.push("");
    parts.push("## Your Persistent Memory");

    const wmText = this.getWorkingMemoryText();
    if (this.workingMemory.length > 0) {
      parts.push("### Working Memory (currently loaded)");
      parts.push(wmText);
    }

    parts.push("");
    parts.push(
      "## Guidelines\n" +
        "- You have persistent memory. Important information is automatically saved between sessions.\n" +
        "- Reference your memories naturally when relevant.\n" +
        "- Be concise and helpful.\n" +
        "- If unsure, say so."
    );

    return parts.join("\n");
  }
}

function detectMemoryType(content: string): MemoryType {
  const lower = content.toLowerCase();
  if (/\b(prefer|like|enjoy|hate|dislike|want)\b/.test(lower))
    return MemoryType.PREFERENCE;
  if (/\b(how to|steps?|process|procedure|method)\b/.test(lower))
    return MemoryType.PROCEDURAL;
  if (/\b(name is|works? at|born|lives? in|age)\b/.test(lower))
    return MemoryType.ENTITY;
  if (/\b(always|never|every|rule|principle|fact)\b/.test(lower))
    return MemoryType.SEMANTIC;
  return MemoryType.EPISODIC;
}

function estimateImportance(content: string): number {
  let score = 0.5;
  const lower = content.toLowerCase();

  if (/\b(important|critical|urgent|deadline|must|never forget)\b/.test(lower))
    score += 0.2;
  if (/\b(name|password|key|secret|api)\b/.test(lower)) score += 0.15;
  if (/\b(prefer|like|hate|always|never)\b/.test(lower)) score += 0.1;
  if (content.length > 100) score += 0.05;
  if (/[A-Z]{2,}/.test(content)) score += 0.05;

  return Math.min(score, 1.0);
}
