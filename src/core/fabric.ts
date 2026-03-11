import { type AgentPersona, type RetrievalResult, type WeaveConfig } from "./types.js";
import { MemoryGraph } from "./graph.js";
import { AgentMemory } from "./agent.js";
import { Storage } from "./storage.js";
import { createEmbeddingBackend, type EmbeddingBackend } from "./embedding.js";

export class MemoryFabric {
  private graph: MemoryGraph;
  private agents = new Map<string, AgentMemory>();
  private storage: Storage | null = null;
  private embedding: EmbeddingBackend;
  private config: WeaveConfig;

  private constructor(config: WeaveConfig, embedding: EmbeddingBackend) {
    this.config = config;
    this.embedding = embedding;
    this.graph = new MemoryGraph(embedding);
  }

  static async create(config: WeaveConfig): Promise<MemoryFabric> {
    const embedding = createEmbeddingBackend(
      config.embeddingBackend,
      config.apiKey,
      config.embeddingModel,
      config.embeddingDim
    );

    const fabric = new MemoryFabric(config, embedding);

    try {
      fabric.storage = await Storage.create(config.workspacePath);
      await fabric.loadFromStorage();
    } catch {
      // Storage unavailable; run in-memory only
    }

    return fabric;
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.storage) return;

    const nodes = this.storage.loadNodes();
    const edges = this.storage.loadEdges();
    await this.graph.deserialize({ nodes, edges });

    const agentStates = this.storage.loadAgents();
    for (const state of agentStates) {
      const agent = new AgentMemory(state.id, state.persona, this.graph);
      this.agents.set(state.id, agent);
    }
  }

  createAgent(id: string, persona: AgentPersona): AgentMemory {
    if (this.agents.has(id)) {
      return this.agents.get(id)!;
    }
    const agent = new AgentMemory(id, persona, this.graph);
    this.agents.set(id, agent);
    this.storage?.saveAgent(id, persona);
    return agent;
  }

  getAgent(id: string): AgentMemory | undefined {
    return this.agents.get(id);
  }

  getOrCreateAgent(id: string, persona: AgentPersona): AgentMemory {
    return this.agents.get(id) || this.createAgent(id, persona);
  }

  listAgents(): AgentMemory[] {
    return Array.from(this.agents.values());
  }

  removeAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    const nodeIds = this.graph.getAgentNodes(id).map((n) => n.id);
    for (const nid of nodeIds) {
      this.graph.removeNode(nid);
    }
    this.agents.delete(id);
    this.storage?.deleteAgent(id);
    return true;
  }

  async queryAcrossAgents(
    query: string,
    k = 5,
    strategy: "vector" | "graph" | "hybrid" = "hybrid"
  ): Promise<RetrievalResult[]> {
    return this.graph.retrieve(query, k, { strategy });
  }

  getGraph(): MemoryGraph {
    return this.graph;
  }

  save(): void {
    if (!this.storage) return;
    const { nodes, edges } = this.graph.serialize();
    this.storage.saveAll(nodes, edges);
    for (const [id, agent] of this.agents) {
      this.storage.saveAgent(id, agent.persona);
    }
  }

  autoSave(): void {
    this.save();
  }

  close(): void {
    this.save();
    this.storage?.close();
  }

  getStats(): {
    agents: number;
    nodes: number;
    edges: number;
  } {
    return {
      agents: this.agents.size,
      nodes: this.graph.nodeCount,
      edges: this.graph.edgeCount,
    };
  }
}
