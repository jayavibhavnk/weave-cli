export interface EmbeddingBackend {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dim: number;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

export class LocalEmbedding implements EmbeddingBackend {
  readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSync(t));
  }

  embedSync(text: string): number[] {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);

    const vec = new Float64Array(this.dim);
    const ngrams: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      ngrams.push(tokens[i]);
      if (i + 1 < tokens.length) {
        ngrams.push(`${tokens[i]}_${tokens[i + 1]}`);
      }
    }

    const counts = new Map<string, number>();
    for (const ng of ngrams) {
      counts.set(ng, (counts.get(ng) || 0) + 1);
    }

    for (const [ng, count] of counts) {
      const h = hashStr(ng);
      const idx = Math.abs(h) % this.dim;
      const sign = h & 1 ? 1 : -1;
      const tf = Math.log1p(count);
      vec[idx] += sign * tf;
    }

    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    }

    return Array.from(vec);
  }
}

export class OpenAIEmbedding implements EmbeddingBackend {
  readonly dim: number;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "text-embedding-3-small", dim = 256) {
    this.apiKey = apiKey;
    this.model = model;
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.apiKey });
    const resp = await client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dim,
    });
    return resp.data.map((d) => d.embedding);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function createEmbeddingBackend(
  backend: "local" | "openai",
  apiKey?: string,
  model?: string,
  dim = 256
): EmbeddingBackend {
  if (backend === "openai") {
    if (!apiKey) throw new Error("OpenAI API key required for OpenAI embeddings");
    return new OpenAIEmbedding(apiKey, model, dim);
  }
  return new LocalEmbedding(dim);
}
