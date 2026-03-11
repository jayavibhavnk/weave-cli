import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { MemoryFabric } from "../../src/core/fabric.js";
import type { WeaveConfig } from "../../src/core/types.js";

describe("MemoryFabric (multi-agent)", () => {
  let fabric: MemoryFabric;
  let workspacePath: string;

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weave-fabric-"));
    workspacePath = path.join(tmp, "test.db");
    const config: WeaveConfig = {
      provider: "openai",
      model: "gpt-4o",
      embeddingModel: "text-embedding-3-small",
      embeddingBackend: "local",
      embeddingDim: 64,
      defaultAgent: "assistant",
      workspacePath,
    };
    fabric = await MemoryFabric.create(config);
  });

  afterAll(() => {
    fabric.close();
  });

  it("creates multiple agents that share the same graph", async () => {
    const alice = fabric.getOrCreateAgent("alice", {
      name: "alice",
      role: "Researcher",
    });
    const bob = fabric.getOrCreateAgent("bob", {
      name: "bob",
      role: "Engineer",
    });

    expect(alice.id).toBe("alice");
    expect(bob.id).toBe("bob");

    await alice.add("Alice's note: use TypeScript for the frontend");
    await bob.add("Bob's note: API deadline is Friday");

    const aliceStats = alice.getMemoryStats();
    const bobStats = bob.getMemoryStats();
    expect(aliceStats.total).toBe(1);
    expect(bobStats.total).toBe(1);

    const graph = fabric.getGraph();
    expect(graph.nodeCount).toBe(2);
  });

  it("queryAcrossAgents returns memories from all agents", async () => {
    const results = await fabric.queryAcrossAgents("deadline", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.node.content.includes("Friday"))).toBe(true);
  });

  it("each agent recall filters by agentId", async () => {
    const alice = fabric.getAgent("alice")!;
    const bob = fabric.getAgent("bob")!;

    const aliceRecall = await alice.recall("TypeScript", 5);
    const bobRecall = await bob.recall("TypeScript", 5);

    expect(aliceRecall.length).toBeGreaterThanOrEqual(1);
    expect(aliceRecall.every((r) => r.node.agentId === "alice")).toBe(true);
    expect(aliceRecall.some((r) => r.node.content.includes("TypeScript"))).toBe(true);
    expect(bobRecall.every((r) => r.node.agentId === "bob")).toBe(true);
  });

  it("listAgents returns all agents", () => {
    const agents = fabric.listAgents();
    expect(agents.map((a) => a.id).sort()).toEqual(["alice", "bob"]);
  });

  it("removeAgent removes agent and its memories", () => {
    const removed = fabric.removeAgent("bob");
    expect(removed).toBe(true);
    expect(fabric.getAgent("bob")).toBeUndefined();
    const graph = fabric.getGraph();
    const nodes = graph.getAllNodes();
    expect(nodes.every((n) => n.agentId !== "bob")).toBe(true);
  });
});
