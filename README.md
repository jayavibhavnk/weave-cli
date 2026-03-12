# weave

**Testing-native memory CLI for AI agents.** Run multi-step test workflows with persistent memory across sessions and specialized QA agents.

> CLI binary name: `weave-test` (replace any older `weave` examples with `weave-test`).

```
  ◈ weave v0.1.0
  graph-native memory for AI agents
```

## What is Weave?

Weave is a terminal CLI agent (like Claude Code) focused on **software testing and quality improvement**. It combines **persistent graph memory** with **multi-agent QA roles** so each run gets smarter over time.

Built on the MemWeave memory architecture plus a test orchestration layer:
- **Multi-layer memory graph** — semantic, temporal, causal, and entity edges
- **Tiered memory** — working → short-term → long-term → archival with automatic promotion and decay
- **Multi-agent** — testing personas (orchestrator, edge-case hunter, report analyst) share a memory fabric
- **Hybrid retrieval** — vector similarity + graph traversal for smarter recall
- **Local-first** — works with just hash-based embeddings + SQLite, no cloud required for memory
- **Testing pipeline** — command discovery (`lint`, `typecheck`, `test`, `integration`, `e2e`, `build`) with clear run reports

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

# Initialize testing agents
weave test init

# Run the testing pipeline on current project
weave test run

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

### Testing (Primary)

```bash
weave test init                         # create test-focused agents
weave test run                          # discover and run tests in current dir
weave test plan                         # preview discovered + autonomous plan
weave test run --dir ../my-app          # run against another project
weave test run --workspace release      # keep separate test memory per workspace
weave test run --provider anthropic     # use another model provider
weave test run --model gpt-4o-mini      # choose specific model for insights
weave test run --max-auto 5             # add up to 5 autonomous expansions
weave test run --no-autonomous          # run only discovered commands

weave-test automation create --name "nightly smoke" --dir . --every 1d
weave-test automation remind "in 45 minutes" --name "rerun tests" --dir .
weave-test automation list
weave-test automation run <id>
weave-test automation daemon            # keep scheduler running locally
```

The testing workflow:
- discovers test commands from project scripts/runtime,
- optionally proposes additional safe commands using autonomous planning (`--max-auto > 0`),
- runs them as a multi-step pipeline,
- analyzes failures and edge-case gaps,
- persists run intelligence to memory for future sessions.

### Automations

`weave-test` now supports durable test automations:

- `automation create` for recurring schedules via `--every` or `--cron`
- `automation remind` for one-time reminders/check-backs
- `automation loop` as a Claude-style recurring shortcut
- `automation daemon` to keep due automations running locally

Examples:

```bash
weave-test automation create --name "daily regression" --dir . --every 1d
weave-test automation create --name "weekday smoke" --dir . --cron "0 9 * * 1-5"
weave-test automation remind "in 2 hours" --name "rerun failed checks" --dir .
weave-test automation loop 30m --name "poll health" --dir . --target testPlan
weave-test automation list
weave-test automation pause <id>
weave-test automation resume <id>
weave-test automation run <id>
weave-test automation daemon --poll-ms 10000
```

### GitHub App Writes

`weave-test` can now write to GitHub through a GitHub App installation identity instead of your local `git push`.

Configure the app:

```bash
weave-test github app init \
  --app-id 123456 \
  --private-key-path /path/to/github-app.pem \
  --owner your-org \
  --repo your-repo

weave-test github app status
weave-test github repo connect --owner your-org --repo your-repo --save-defaults
```

Create a branch, commit local files to GitHub, and open a PR:

```bash
weave-test github branch create --branch weavetest/demo --base main
weave-test github commit --branch weavetest/demo --message "Update test flow" --dir . src/index.ts README.md
weave-test github pr create --title "Update test flow" --head weavetest/demo --base main
```

`weave-test github push` is also available as a commit-and-update-ref alias if you prefer that wording.

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
