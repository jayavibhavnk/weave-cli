# weave

**Graph-native memory CLI for AI agents.** Chat with AI that actually remembers — across sessions, across agents.

```
  ◈ weave v0.1.0
  graph-native memory for AI agents
```

## What is Weave?

Weave is a terminal CLI agent (like Claude Code) with a twist: **persistent, graph-structured memory**. Every conversation is remembered. Memories are connected by semantic similarity, temporal sequence, and shared entities. Your agents build knowledge over time — they never cold-start.

Built on the MemWeave memory architecture:
- **Multi-layer memory graph** — semantic, temporal, causal, and entity edges
- **Tiered memory** — working → short-term → long-term → archival with automatic promotion and decay
- **Multi-agent** — spawn multiple agents with different personas that share a memory fabric
- **Hybrid retrieval** — vector similarity + graph traversal for smarter recall
- **Local-first** — works with just hash-based embeddings + SQLite, no cloud required for memory

## Install

```bash
npm install -g weave-cli
```

Or from source:

```bash
git clone <repo>
cd cliproject
npm install
npm run build
npm link
```

## Quick Start

```bash
# Initialize
weave init

# Set your API key (or use Codex auth — see below)
weave config set apiKey sk-your-openai-key

# Start chatting (memories persist automatically)
weave chat

# Or use Anthropic
weave config set provider anthropic
weave config set apiKey sk-ant-your-key
weave config set model claude-sonnet-4-20250514
weave chat

# Or use Ollama (local, no API key required)
weave config set provider ollama
weave config set model llama3.2
weave chat

# Or use LM Studio (local; start a model in LM Studio first)
weave config set provider lmstudio
weave config set model local-model
weave chat
```

## Commands

### Chat

```bash
weave chat                          # interactive chat with memory
weave chat --agent researcher       # chat as specific agent
weave chat --model gpt-4o-mini      # use a different model
weave chat --provider anthropic     # use Anthropic
weave chat --provider ollama        # use Ollama (local)
weave chat --provider lmstudio      # use LM Studio (local)
```

In-chat slash commands:
| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/memory` | Show working memory |
| `/recall <query>` | Search all memories |
| `/agents` | List all agents |
| `/switch <agent>` | Switch to another agent |
| `/stats` | Memory statistics |
| `/compact` | Run memory consolidation |
| `/save` | Force save |
| `/clear` | Clear chat history (keeps memories) |
| `/exit` | Exit weave |

### Agents

```bash
weave agent spawn researcher --role "ML Researcher"
weave agent spawn engineer --role "Software Engineer" --model gpt-4o-mini
weave agent list
weave agent inspect researcher
weave agent kill researcher
```

### Memory

```bash
weave memory add "The deadline is March 15" --agent researcher
weave memory search "project deadline"
weave memory search "tech stack" --agent researcher
weave memory list
weave memory list --agent researcher
weave memory consolidate               # promote, merge, decay, prune
```

### Configuration

```bash
weave config set apiKey sk-...
weave config set provider openai       # or anthropic, ollama, lmstudio
weave config set model gpt-4o
weave config set baseURL http://localhost:11434/v1  # for ollama/lmstudio (optional)
weave config set embeddingBackend local # or openai
weave config set useCodexAuth true   # use OpenAI key from Codex auth (default: true)
weave config list
weave config get provider
```

**OpenAI without setting an API key (Codex login):** If you use [OpenAI Codex](https://developers.openai.com/codex) and have run `codex login --api-key <key>`, Weave can use the cached key from `~/.codex/auth.json` so you don't need to set `weave config set apiKey`. Ensure `useCodexAuth` is not set to `false`. Set `CODEX_HOME` if your Codex config lives elsewhere.

### Workspaces

```bash
weave workspace create ml-research
weave workspace list
weave chat --workspace ml-research
```

### Diagnostics

```bash
weave doctor                           # system health check
```

## Memory Architecture

```
Working Memory (L1)   ← In-context, immediate access
       ↓ eviction
Short-Term Memory (L2) ← Recent, fast retrieval
       ↓ consolidation (importance-based)
Long-Term Memory (L3)  ← Consolidated, graph-structured
       ↓ aging
Archival Memory (L4)   ← Old, rarely accessed
```

Memories are automatically:
- **Embedded** using local hash projections (zero-latency) or OpenAI embeddings
- **Linked** by semantic similarity, temporal order, and shared entities
- **Scored** by importance × recency × access frequency
- **Promoted** from short-term to long-term when importance ≥ 0.4
- **Decayed** over time, with archival memories pruned when importance drops below 0.01
- **Merged** when duplicates are detected (cosine similarity ≥ 0.92)

## Architecture

```
src/
├── core/
│   ├── types.ts        # Core type definitions
│   ├── embedding.ts    # Local hash + OpenAI embedding backends
│   ├── graph.ts        # Multi-layer memory graph with retrieval
│   ├── storage.ts      # SQLite persistence
│   ├── agent.ts        # Per-agent memory + extraction
│   └── fabric.ts       # Memory fabric orchestrator
├── llm/
│   └── provider.ts     # OpenAI + Anthropic with streaming
├── ui/
│   ├── theme.ts        # Terminal colors, icons, components
│   └── chat.ts         # Interactive chat REPL
├── config.ts           # Configuration management
└── index.ts            # CLI entry point
```

## Config Storage

All data lives in `~/.weave/`:
```
~/.weave/
├── config.json          # Global configuration
└── workspaces/
    ├── default.db       # Default workspace (SQLite)
    └── ml-research.db   # Named workspaces
```

## Requirements

- Node.js ≥ 18
- An API key (OpenAI or Anthropic) for chat

## License

MIT
