# Weave test plan

Overview of what can be tested and how, to find bugs and guard regressions.

---

## 1. Pure / highly testable (unit tests)

| Area | What to test | Notes |
|------|----------------|------|
| **core/types.ts** | `createMemoryNode`, `generateId`, `effectiveImportance`, `touchNode` | No I/O. Id format, node shape, importance formula, touchNode mutates and caps importance. |
| **core/embedding.ts** | `LocalEmbedding.embed` / `embedSync`, `cosineSimilarity`, `createEmbeddingBackend("local")` | Local path is pure. Same text → same vector; cosine same vec = 1, orthog ≈ 0; dim and normalization. |
| **tools/definitions.ts** | `toOpenAITools`, `toAnthropicTools` | Shape of tool definitions for each provider. |
| **ui/commands.ts** | `findCommand`, `getCompletions` | Slash parsing, hidden commands excluded from completions. |
| **config (partial)** | `resolveApiKey`, `getProviderBaseURL` | Pure given a config object. Local providers return placeholder key; baseURL defaults. |
| **config** | `setConfigValue` validation | Invalid provider or non-numeric embeddingDim throws. |

---

## 2. Core logic with minimal deps (unit tests with mocks/fakes)

| Area | What to test | Notes |
|------|----------------|------|
| **core/graph.ts** | `MemoryGraph`: addNode, removeNode, retrieve (vector/graph/hybrid), consolidate, serialize/deserialize | Use `LocalEmbedding` (no API). In-memory only. |
| **core/agent.ts** | `buildSystemPrompt` shape, working memory section | Mock or fake graph; no WEAVE.md on disk. |

---

## 3. I/O and integration-style tests

| Area | What to test | Notes |
|------|----------------|------|
| **config.ts** | `loadConfig`, `saveConfig`, `getWorkspacePath`, `listWorkspaces` | Use temp dir (e.g. mock `os.homedir()` or env) so real `~/.weave` is not touched. |
| **core/storage.ts** | Create DB, save/load nodes and edges, save/load agents, close | Use `:memory:` or temp file. |
| **tools/executor.ts** | `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, unknown tool | Temp dir; safe commands only (e.g. `echo`, `true`). |
| **core/fabric.ts** | Create fabric, create agent, add memory, query, save/close | Temp workspace path; in-memory or temp DB. |

---

## 4. Harder to test (optional / e2e)

| Area | Why harder | Possible approach |
|------|------------|-------------------|
| **llm/provider.ts** | Needs API keys or live Ollama/LM Studio | Mock `fetch` / axios or use test doubles; or mark as e2e and skip in CI. |
| **ui/app.tsx** | Ink/React, stdin, async chat loop | Component tests with testing-library, or shallow render of presentational pieces. |
| **index.ts (CLI)** | Commander, process.exit, dynamic imports | Spawn `node dist/index.js` and assert on stdout/exit code for `weave --version`, `weave config list`, etc. |
| **web/server.ts** | HTTP server, browser | Supertest or similar against the server. |
| **tools/mcp.ts** | Subprocess, JSON-RPC | Mock spawn or run against a dummy MCP server. |

---

## 5. Bug-oriented checks (what to assert)

- **Ids**: `generateId()` is non-empty, unique enough in a tight loop.
- **Embedding**: `LocalEmbedding` dim matches constructor; normalized vector has length 1; similar strings have higher cosine than unrelated.
- **Graph**: After `removeNode`, node and its edges are gone. After `consolidate`, duplicate-like nodes merged, tiers updated.
- **Config**: `resolveApiKey` for `ollama`/`lmstudio` never returns undefined; invalid provider throws.
- **Executor**: Path traversal (e.g. `../../../etc/passwd`) rejected or constrained; non-existent file returns error.
- **Storage**: Round-trip save/load preserves node and edge fields; loadAgents returns correct memoryCount.
- **Commands**: `findCommand("/help")` returns help command; `findCommand("/unknown")` returns null; completions don’t include `/quit` if hidden.

---

## 6. Test layout

- **Runner**: Vitest (ESM + TypeScript, fast). Run with `npm test`.
- **Location**: `tests/` at repo root; imports from `../src/...`.
- **Naming**: `*.test.ts` (e.g. `tests/core/types.test.ts`, `tests/config.test.ts`).
- **Isolation**: Storage and executor tests use `os.tmpdir()` so they don’t touch real user data. Config tests only assert validation (invalid provider/embeddingDim throw); tests that would write to `~/.weave/config.json` are omitted to avoid permission issues in CI/sandbox.
