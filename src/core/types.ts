export enum MemoryTier {
  WORKING = "working",
  SHORT_TERM = "short_term",
  LONG_TERM = "long_term",
  ARCHIVAL = "archival",
}

export enum MemoryScope {
  PRIVATE = "private",
  TEAM = "team",
  GLOBAL = "global",
}

export enum MemoryType {
  EPISODIC = "episodic",
  SEMANTIC = "semantic",
  PROCEDURAL = "procedural",
  PREFERENCE = "preference",
  ENTITY = "entity",
}

export enum EdgeType {
  SEMANTIC = "semantic",
  TEMPORAL = "temporal",
  CAUSAL = "causal",
  ENTITY = "entity",
}

export interface MemoryNode {
  id: string;
  content: string;
  memoryType: MemoryType;
  tier: MemoryTier;
  scope: MemoryScope;
  agentId: string;
  importance: number;
  embedding: number[];
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  decayRate: number;
  entities: string[];
  metadata: Record<string, unknown>;
}

export interface MemoryEdge {
  sourceId: string;
  targetId: string;
  edgeType: EdgeType;
  weight: number;
  createdAt: number;
}

export interface RetrievalResult {
  node: MemoryNode;
  score: number;
  source: "vector" | "graph" | "hybrid";
}

export interface AgentPersona {
  name: string;
  role: string;
  description?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
}

export interface AgentState {
  id: string;
  persona: AgentPersona;
  createdAt: number;
  lastActive: number;
  memoryCount: number;
}

export interface ConsolidationResult {
  promoted: number;
  merged: number;
  decayed: number;
  pruned: number;
}

export interface WeaveConfig {
  provider: "openai" | "anthropic";
  apiKey?: string;
  model: string;
  embeddingModel: string;
  embeddingBackend: "local" | "openai";
  embeddingDim: number;
  defaultAgent: string;
  workspacePath: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  timestamp?: number;
}

export function createMemoryNode(
  content: string,
  agentId: string,
  opts: Partial<MemoryNode> = {}
): MemoryNode {
  const now = Date.now();
  return {
    id: generateId(),
    content,
    memoryType: MemoryType.EPISODIC,
    tier: MemoryTier.SHORT_TERM,
    scope: MemoryScope.PRIVATE,
    agentId,
    importance: 0.5,
    embedding: [],
    createdAt: now,
    lastAccessed: now,
    accessCount: 0,
    decayRate: 0.0001,
    entities: [],
    metadata: {},
    ...opts,
  };
}

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

export function effectiveImportance(node: MemoryNode): number {
  const stalenessSec = (Date.now() - node.lastAccessed) / 1000;
  const timeFactor = Math.exp(-node.decayRate * stalenessSec);
  const accessFactor = Math.min(Math.log1p(node.accessCount) / 5, 1);
  return node.importance * (0.6 * timeFactor + 0.4 * accessFactor);
}

export function touchNode(node: MemoryNode): void {
  node.lastAccessed = Date.now();
  node.accessCount++;
  node.importance = Math.min(node.importance + 0.02, 1.0);
}
