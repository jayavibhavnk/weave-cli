import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { Storage } from "../../src/core/storage.js";
import {
  createMemoryNode,
  type MemoryEdge,
  EdgeType,
  type AgentPersona,
} from "../../src/core/types.js";

describe("Storage", () => {
  let dbPath: string;
  let storage: Storage;

  beforeAll(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weave-storage-"));
    dbPath = path.join(tmp, "test.db");
    storage = await Storage.create(dbPath);
  });

  afterAll(() => {
    storage.close();
  });

  it("saves and loads nodes", () => {
    const node = createMemoryNode("hello", "agent1");
    node.embedding = [0.1, 0.2];
    storage.saveNode(node);
    const loaded = storage.loadNodes();
    expect(loaded.length).toBe(1);
    expect(loaded[0].content).toBe("hello");
    expect(loaded[0].agentId).toBe("agent1");
    expect(loaded[0].embedding).toEqual([0.1, 0.2]);
  });

  it("saves and loads edges", () => {
    const edge: MemoryEdge = {
      sourceId: "id1",
      targetId: "id2",
      edgeType: EdgeType.SEMANTIC,
      weight: 0.8,
      createdAt: Date.now(),
    };
    storage.saveEdge(edge);
    const loaded = storage.loadEdges();
    expect(loaded.some((e) => e.sourceId === "id1" && e.targetId === "id2")).toBe(
      true
    );
  });

  it("saves and loads agents", () => {
    const persona: AgentPersona = {
      name: "test-agent",
      role: "Tester",
    };
    storage.saveAgent("test-agent", persona);
    const agents = storage.loadAgents();
    expect(agents.some((a) => a.id === "test-agent")).toBe(true);
    const one = storage.loadAgent("test-agent");
    expect(one).not.toBeNull();
    expect(one!.persona.name).toBe("test-agent");
  });

  it("loadAgent returns null for missing id", () => {
    expect(storage.loadAgent("nonexistent-id")).toBeNull();
  });

  it("deleteNode removes node", () => {
    const node = createMemoryNode("to delete", "a");
    storage.saveNode(node);
    storage.deleteNode(node.id);
    const loaded = storage.loadNodes();
    expect(loaded.find((n) => n.id === node.id)).toBeUndefined();
  });
});
