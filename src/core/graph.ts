import {
  MemoryNode,
  MemoryEdge,
  EdgeType,
  RetrievalResult,
  MemoryTier,
  MemoryScope,
  effectiveImportance,
  touchNode,
  ConsolidationResult,
} from "./types.js";
import { cosineSimilarity, type EmbeddingBackend } from "./embedding.js";

export class MemoryGraph {
  private nodes = new Map<string, MemoryNode>();
  private edges = new Map<EdgeType, MemoryEdge[]>();
  private adjacency = new Map<string, Map<string, MemoryEdge[]>>();
  private embedding: EmbeddingBackend;

  constructor(embedding: EmbeddingBackend) {
    this.embedding = embedding;
    for (const t of Object.values(EdgeType)) {
      this.edges.set(t as EdgeType, []);
    }
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    let c = 0;
    for (const edges of this.edges.values()) c += edges.length;
    return c;
  }

  getNode(id: string): MemoryNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): MemoryNode[] {
    return Array.from(this.nodes.values());
  }

  getAgentNodes(agentId: string): MemoryNode[] {
    return this.getAllNodes().filter((n) => n.agentId === agentId);
  }

  async addNode(node: MemoryNode, autoLink = true): Promise<void> {
    if (node.embedding.length === 0) {
      node.embedding = await this.embedding.embed(node.content);
    }
    this.nodes.set(node.id, node);

    if (autoLink) {
      this.autoLink(node);
    }
  }

  removeNode(id: string): boolean {
    if (!this.nodes.delete(id)) return false;
    for (const [type, list] of this.edges) {
      this.edges.set(
        type,
        list.filter((e) => e.sourceId !== id && e.targetId !== id)
      );
    }
    this.adjacency.delete(id);
    for (const adj of this.adjacency.values()) {
      adj.delete(id);
    }
    return true;
  }

  addEdge(edge: MemoryEdge): void {
    const list = this.edges.get(edge.edgeType);
    if (list) list.push(edge);

    if (!this.adjacency.has(edge.sourceId)) {
      this.adjacency.set(edge.sourceId, new Map());
    }
    const adj = this.adjacency.get(edge.sourceId)!;
    if (!adj.has(edge.targetId)) adj.set(edge.targetId, []);
    adj.get(edge.targetId)!.push(edge);
  }

  getNeighbors(nodeId: string, edgeType?: EdgeType): MemoryNode[] {
    const adj = this.adjacency.get(nodeId);
    if (!adj) return [];
    const result: MemoryNode[] = [];
    for (const [targetId, edges] of adj) {
      if (edgeType && !edges.some((e) => e.edgeType === edgeType)) continue;
      const node = this.nodes.get(targetId);
      if (node) result.push(node);
    }
    return result;
  }

  private autoLink(node: MemoryNode): void {
    this.linkSemantic(node, 5, 0.15);
    this.linkTemporal(node);
    this.linkEntities(node);
  }

  private linkSemantic(node: MemoryNode, k: number, threshold: number): void {
    if (node.embedding.length === 0) return;

    const scored: { id: string; sim: number }[] = [];
    for (const [id, other] of this.nodes) {
      if (id === node.id || other.embedding.length === 0) continue;
      const sim = cosineSimilarity(node.embedding, other.embedding);
      if (sim > threshold) scored.push({ id, sim });
    }

    scored.sort((a, b) => b.sim - a.sim);
    for (const { id, sim } of scored.slice(0, k)) {
      this.addEdge({
        sourceId: node.id,
        targetId: id,
        edgeType: EdgeType.SEMANTIC,
        weight: sim,
        createdAt: Date.now(),
      });
    }
  }

  private linkTemporal(node: MemoryNode): void {
    let closest: MemoryNode | null = null;
    let closestDiff = Infinity;

    for (const [id, other] of this.nodes) {
      if (id === node.id || other.agentId !== node.agentId) continue;
      const diff = node.createdAt - other.createdAt;
      if (diff > 0 && diff < closestDiff) {
        closestDiff = diff;
        closest = other;
      }
    }

    if (closest) {
      this.addEdge({
        sourceId: closest.id,
        targetId: node.id,
        edgeType: EdgeType.TEMPORAL,
        weight: 1.0,
        createdAt: Date.now(),
      });
    }
  }

  private linkEntities(node: MemoryNode): void {
    if (node.entities.length === 0) return;
    const nodeEnts = new Set(node.entities);

    for (const [id, other] of this.nodes) {
      if (id === node.id || other.entities.length === 0) continue;
      const overlap = other.entities.filter((e) => nodeEnts.has(e));
      if (overlap.length > 0) {
        this.addEdge({
          sourceId: node.id,
          targetId: id,
          edgeType: EdgeType.ENTITY,
          weight: overlap.length / Math.max(node.entities.length, other.entities.length),
          createdAt: Date.now(),
        });
      }
    }
  }

  async retrieve(
    query: string,
    k = 5,
    opts: {
      agentFilter?: string;
      scopeFilter?: MemoryScope[];
      tierFilter?: MemoryTier[];
      strategy?: "vector" | "graph" | "hybrid";
    } = {}
  ): Promise<RetrievalResult[]> {
    const queryEmbedding = await this.embedding.embed(query);
    const strategy = opts.strategy || "hybrid";

    let results: RetrievalResult[];

    if (strategy === "vector") {
      results = this.vectorSearch(queryEmbedding, k * 3);
    } else if (strategy === "graph") {
      results = this.graphSearch(queryEmbedding, k * 3);
    } else {
      const vectorResults = this.vectorSearch(queryEmbedding, k * 2);
      const graphResults = this.graphSearch(queryEmbedding, k * 2);
      results = this.fuseResults(vectorResults, graphResults, 0.6, 0.4);
    }

    results = results.filter((r) => {
      if (opts.agentFilter && r.node.agentId !== opts.agentFilter) return false;
      if (opts.scopeFilter && !opts.scopeFilter.includes(r.node.scope)) return false;
      if (opts.tierFilter && !opts.tierFilter.includes(r.node.tier)) return false;
      return true;
    });

    for (const r of results) touchNode(r.node);
    return results.slice(0, k);
  }

  private vectorSearch(queryEmb: number[], k: number): RetrievalResult[] {
    const scored: RetrievalResult[] = [];

    for (const node of this.nodes.values()) {
      if (node.embedding.length === 0) continue;
      const sim = cosineSimilarity(queryEmb, node.embedding);
      const boost = effectiveImportance(node) * 0.1;
      scored.push({ node, score: sim + boost, source: "vector" });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  private graphSearch(queryEmb: number[], k: number): RetrievalResult[] {
    const seeds = this.vectorSearch(queryEmb, 3);
    const visited = new Set<string>();
    const scored: RetrievalResult[] = [];

    const queue = seeds.map((s) => ({ node: s.node, depth: 0 }));

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.node.id)) continue;
      visited.add(item.node.id);

      const sim = cosineSimilarity(queryEmb, item.node.embedding);
      const imp = effectiveImportance(item.node);
      scored.push({
        node: item.node,
        score: 0.7 * sim + 0.3 * imp,
        source: "graph",
      });

      if (item.depth < 2) {
        for (const neighbor of this.getNeighbors(item.node.id)) {
          if (!visited.has(neighbor.id)) {
            queue.push({ node: neighbor, depth: item.depth + 1 });
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  private fuseResults(
    a: RetrievalResult[],
    b: RetrievalResult[],
    wA: number,
    wB: number
  ): RetrievalResult[] {
    const scoreMap = new Map<string, { node: MemoryNode; score: number }>();

    for (const r of a) {
      scoreMap.set(r.node.id, { node: r.node, score: r.score * wA });
    }
    for (const r of b) {
      const existing = scoreMap.get(r.node.id);
      if (existing) {
        existing.score += r.score * wB;
      } else {
        scoreMap.set(r.node.id, { node: r.node, score: r.score * wB });
      }
    }

    return Array.from(scoreMap.values())
      .map((v) => ({ node: v.node, score: v.score, source: "hybrid" as const }))
      .sort((a, b) => b.score - a.score);
  }

  consolidate(): ConsolidationResult {
    let promoted = 0,
      merged = 0,
      decayed = 0,
      pruned = 0;

    for (const node of this.nodes.values()) {
      const imp = effectiveImportance(node);

      if (node.tier === MemoryTier.SHORT_TERM && imp >= 0.4) {
        node.tier = MemoryTier.LONG_TERM;
        promoted++;
      }

      const stalenessDays = (Date.now() - node.lastAccessed) / 86_400_000;
      if (node.tier === MemoryTier.LONG_TERM && stalenessDays > 30) {
        node.tier = MemoryTier.ARCHIVAL;
        decayed++;
      }

      if (node.tier === MemoryTier.ARCHIVAL && imp < 0.01) {
        this.removeNode(node.id);
        pruned++;
      }
    }

    const dupes = this.findDuplicates(0.92);
    for (const [keepId, removeId] of dupes) {
      this.mergeNodes(keepId, removeId);
      merged++;
    }

    return { promoted, merged, decayed, pruned };
  }

  private findDuplicates(threshold: number): [string, string][] {
    const pairs: [string, string][] = [];
    const nodes = this.getAllNodes().filter((n) => n.embedding.length > 0);
    const removed = new Set<string>();

    for (let i = 0; i < nodes.length; i++) {
      if (removed.has(nodes[i].id)) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        if (removed.has(nodes[j].id)) continue;
        const sim = cosineSimilarity(nodes[i].embedding, nodes[j].embedding);
        if (sim >= threshold) {
          const keepIdx = effectiveImportance(nodes[i]) >= effectiveImportance(nodes[j]) ? i : j;
          const removeIdx = keepIdx === i ? j : i;
          pairs.push([nodes[keepIdx].id, nodes[removeIdx].id]);
          removed.add(nodes[removeIdx].id);
        }
      }
    }

    return pairs;
  }

  private mergeNodes(keepId: string, removeId: string): void {
    const keep = this.nodes.get(keepId);
    const remove = this.nodes.get(removeId);
    if (!keep || !remove) return;

    keep.accessCount += remove.accessCount;
    keep.importance = Math.max(keep.importance, remove.importance);
    if (remove.createdAt < keep.createdAt) keep.createdAt = remove.createdAt;

    this.removeNode(removeId);
  }

  serialize(): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
    const allEdges: MemoryEdge[] = [];
    for (const list of this.edges.values()) allEdges.push(...list);
    return { nodes: this.getAllNodes(), edges: allEdges };
  }

  async deserialize(data: { nodes: MemoryNode[]; edges: MemoryEdge[] }): Promise<void> {
    this.nodes.clear();
    for (const t of Object.values(EdgeType)) {
      this.edges.set(t as EdgeType, []);
    }
    this.adjacency.clear();

    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
    }
    for (const edge of data.edges) {
      this.addEdge(edge);
    }
  }
}
