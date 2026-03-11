import { describe, it, expect } from "vitest";
import {
  LocalEmbedding,
  cosineSimilarity,
  createEmbeddingBackend,
} from "../../src/core/embedding.js";

describe("embedding", () => {
  describe("LocalEmbedding", () => {
    it("produces vector of correct dimension", async () => {
      const emb = new LocalEmbedding(256);
      const vec = await emb.embed("hello world");
      expect(vec).toHaveLength(256);
    });

    it("same text gives same vector", async () => {
      const emb = new LocalEmbedding(64);
      const a = await emb.embed("identical");
      const b = await emb.embed("identical");
      expect(a).toEqual(b);
    });

    it("embedSync is deterministic", () => {
      const emb = new LocalEmbedding(64);
      expect(emb.embedSync("test")).toEqual(emb.embedSync("test"));
    });

    it("different text gives different vector", async () => {
      const emb = new LocalEmbedding(64);
      const a = await emb.embed("hello");
      const b = await emb.embed("goodbye");
      expect(a).not.toEqual(b);
    });

    it("vector is normalized (length 1) when it has non-zero content", () => {
      const emb = new LocalEmbedding(64);
      const vec = emb.embedSync("hello world foo bar");
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    });
  });

  describe("cosineSimilarity", () => {
    it("identical vectors give 1", () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBe(1);
    });

    it("orthogonal vectors give 0", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    });

    it("opposite vectors give -1", () => {
      expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBe(-1);
    });

    it("different length vectors return 0", () => {
      expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it("zero vector gives 0", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
    });
  });

  describe("createEmbeddingBackend", () => {
    it("returns LocalEmbedding for local", () => {
      const backend = createEmbeddingBackend("local", undefined, undefined, 128);
      expect(backend).toBeInstanceOf(LocalEmbedding);
      expect(backend.dim).toBe(128);
    });

    it("throws for openai without api key", () => {
      expect(() =>
        createEmbeddingBackend("openai", undefined, undefined, 256)
      ).toThrow("OpenAI API key required");
    });
  });
});
