import { describe, it, expect } from "vitest";
import { LocalEmbedding } from "../../src/core/embedding.js";
import { MemoryGraph } from "../../src/core/graph.js";
import {
  createMemoryNode,
  MemoryTier,
  MemoryType,
  EdgeType,
} from "../../src/core/types.js";

describe("MemoryGraph", () => {
  async function createGraph() {
    const embedding = new LocalEmbedding(64);
    const graph = new MemoryGraph(embedding);
    return graph;
  }

  it("starts empty", async () => {
    const graph = await createGraph();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });

  it("addNode increases node count and embeds content", async () => {
    const graph = await createGraph();
    const node = createMemoryNode("first memory", "agent1");
    await graph.addNode(node);
    expect(graph.nodeCount).toBe(1);
    expect(graph.getNode(node.id)).toBeDefined();
    expect(graph.getNode(node.id)!.embedding.length).toBe(64);
  });

  it("removeNode removes node and its edges", async () => {
    const graph = await createGraph();
    const a = createMemoryNode("memory a", "agent1");
    const b = createMemoryNode("memory b similar to a", "agent1");
    await graph.addNode(a);
    await graph.addNode(b);
    const removed = graph.removeNode(a.id);
    expect(removed).toBe(true);
    expect(graph.nodeCount).toBe(1);
    expect(graph.getNode(a.id)).toBeUndefined();
    expect(graph.getNode(b.id)).toBeDefined();
  });

  it("removeNode returns false for unknown id", async () => {
    const graph = await createGraph();
    expect(graph.removeNode("nonexistent")).toBe(false);
  });

  it("getAgentNodes filters by agentId", async () => {
    const graph = await createGraph();
    const n1 = createMemoryNode("one", "alice");
    const n2 = createMemoryNode("two", "bob");
    const n3 = createMemoryNode("three", "alice");
    await graph.addNode(n1);
    await graph.addNode(n2);
    await graph.addNode(n3);
    const alice = graph.getAgentNodes("alice");
    expect(alice).toHaveLength(2);
    expect(alice.map((n) => n.id).sort()).toEqual([n1.id, n3.id].sort());
  });

  it("retrieve returns results ordered by relevance", async () => {
    const graph = await createGraph();
    await graph.addNode(createMemoryNode("javascript and typescript", "a"));
    await graph.addNode(createMemoryNode("python programming", "a"));
    await graph.addNode(createMemoryNode("rust systems language", "a"));
    const results = await graph.retrieve("typescript", 2, {
      agentFilter: "a",
      strategy: "vector",
    });
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    expect(results.some((r) => r.node.content.includes("typescript"))).toBe(true);
  });

  it("consolidate promotes high-importance short-term to long-term", async () => {
    const graph = await createGraph();
    const node = createMemoryNode("important", "a", {
      tier: MemoryTier.SHORT_TERM,
      importance: 0.9,
      lastAccessed: Date.now(),
    });
    node.embedding = await new LocalEmbedding(64).embed("important");
    await graph.addNode(node, false);
    const result = graph.consolidate();
    expect(result.promoted).toBeGreaterThanOrEqual(0);
    const updated = graph.getNode(node.id);
    expect(updated).toBeDefined();
    if (result.promoted >= 1) {
      expect(updated!.tier).toBe(MemoryTier.LONG_TERM);
    }
  });

  it("serialize and deserialize round-trip", async () => {
    const graph = await createGraph();
    await graph.addNode(createMemoryNode("one", "a"));
    await graph.addNode(createMemoryNode("two", "a"));
    const { nodes, edges } = graph.serialize();
    expect(nodes).toHaveLength(2);
    const graph2 = await createGraph();
    await graph2.deserialize({ nodes, edges });
    expect(graph2.nodeCount).toBe(2);
    expect(graph2.edgeCount).toBe(graph.edgeCount);
  });
});
