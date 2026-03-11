import { describe, it, expect } from "vitest";
import {
  createMemoryNode,
  generateId,
  effectiveImportance,
  touchNode,
  MemoryTier,
  MemoryType,
  MemoryScope,
} from "../../src/core/types.js";

describe("types", () => {
  describe("generateId", () => {
    it("returns non-empty string", () => {
      expect(generateId()).toBeTruthy();
      expect(typeof generateId()).toBe("string");
    });

    it("returns unique ids in a tight loop", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) ids.add(generateId());
      expect(ids.size).toBe(100);
    });

    it("id format contains timestamp and random part", () => {
      const id = generateId();
      expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe("createMemoryNode", () => {
    it("creates node with required fields and defaults", () => {
      const node = createMemoryNode("hello world", "agent1");
      expect(node.content).toBe("hello world");
      expect(node.agentId).toBe("agent1");
      expect(node.id).toBeTruthy();
      expect(node.memoryType).toBe(MemoryType.EPISODIC);
      expect(node.tier).toBe(MemoryTier.SHORT_TERM);
      expect(node.scope).toBe(MemoryScope.PRIVATE);
      expect(node.importance).toBe(0.5);
      expect(node.embedding).toEqual([]);
      expect(node.entities).toEqual([]);
      expect(node.metadata).toEqual({});
      expect(node.createdAt).toBeLessThanOrEqual(Date.now() + 1);
      expect(node.lastAccessed).toBeLessThanOrEqual(Date.now() + 1);
      expect(node.accessCount).toBe(0);
      expect(node.decayRate).toBe(0.0001);
    });

    it("merges opts over defaults", () => {
      const node = createMemoryNode("x", "a", {
        importance: 0.9,
        tier: MemoryTier.LONG_TERM,
        entities: ["foo"],
      });
      expect(node.importance).toBe(0.9);
      expect(node.tier).toBe(MemoryTier.LONG_TERM);
      expect(node.entities).toEqual(["foo"]);
    });
  });

  describe("effectiveImportance", () => {
    it("scales base importance by time and access (zero access ≈ 0.6 * importance)", () => {
      const node = createMemoryNode("x", "a", { importance: 0.6 });
      const imp = effectiveImportance(node);
      expect(imp).toBeLessThanOrEqual(0.6 + 0.01);
      expect(imp).toBeGreaterThanOrEqual(0.35);
    });

    it("increases when accessCount is higher (vs zero)", () => {
      const nodeZero = createMemoryNode("x", "a", { importance: 0.5 });
      nodeZero.lastAccessed = Date.now();
      const impZero = effectiveImportance(nodeZero);

      const nodeMany = createMemoryNode("y", "a", { importance: 0.5 });
      nodeMany.accessCount = 100;
      nodeMany.lastAccessed = Date.now();
      const impMany = effectiveImportance(nodeMany);

      expect(impMany).toBeGreaterThan(impZero);
    });
  });

  describe("touchNode", () => {
    it("updates lastAccessed and increments accessCount", () => {
      const node = createMemoryNode("x", "a");
      const before = node.lastAccessed;
      const beforeCount = node.accessCount;
      touchNode(node);
      expect(node.lastAccessed).toBeGreaterThanOrEqual(before);
      expect(node.accessCount).toBe(beforeCount + 1);
    });

    it("caps importance at 1.0", () => {
      const node = createMemoryNode("x", "a", { importance: 0.99 });
      touchNode(node);
      expect(node.importance).toBeLessThanOrEqual(1.0);
    });
  });
});
