# Weave vs. Cursor, Claude Code CLI, Letta CLI — How to Improve Your App

You’ve built **Weave**: a graph-native memory CLI for AI agents with persistent multi-layer memory, multi-agent support, workspaces, file/code tools, MCP, and slash commands. Below is a comparison with **Cursor’s agent system**, **Claude Code CLI** (session-based terminal coding), and **Letta Code** (stateful agent CLI), plus concrete ways to make Weave better.

---

## 1. What You Have vs. What Others Do

| Area | **Weave (yours)** | **Cursor** | **Letta Code** |
|------|-------------------|------------|----------------|
| **Memory** | Graph (L1→L4), semantic/temporal/entity edges, consolidation | Session + rules; no cross-session memory | MemFS (git-backed markdown), reflection/defrag subagents |
| **Context** | WEAVE.md, working memory, recalled memories | @ mentions (files, folders, docs, symbols), rules | system/ folder pinned, memory tree, /init |
| **Tools** | read/write/edit file, run_command, list/search, MCP | 15+ (search, edit, terminal, web, image, etc.) | File/code tools + skills + subagents |
| **Personality** | Per-agent persona, role, systemPrompt | Rules (.cursor/rules, AGENTS.md) | Editable persona.md, memory self-edit |
| **Session** | Chat history + persistent memory | Single conversation | Conversations + persistent agent |
| **CLI** | weave chat, agent/memory/config/workspace | N/A (IDE) | letta, /new, /resume, --continue, headless |

Your differentiator is **graph-native memory** (tiers, edges, consolidation). The others either have no persistent memory (Cursor session, Claude Code) or a different model (Letta: markdown + reflection). You can lean into the graph and still adopt patterns from the rest.

---

## 2. System Prompt & Instructions (Cursor-style)

Cursor’s agent uses a clear system prompt that:

- States identity (“AI coding assistant”), context (rules, @-attached content), and **how to use tools** (when to read/edit/run, be concise, cite code with `file:line`).
- Relies on **rules** (`.cursor/rules/`, AGENTS.md) for project-specific behavior.

**Improve Weave’s system prompt:**

1. **Structured sections**  
   Keep: persona, WEAVE.md, working memory, recalled context. Add:
   - **Tool use**: “Use tools when the user asks to examine, edit, or run something. Prefer read_file before edit_file. For code, cite as `path:startLine-endLine`.”
   - **Memory**: “You have persistent memory. Refer to recalled context when relevant. Don’t repeat stored facts; build on them.”
   - **Formatting**: “Use backticks for file/command/symbol names; use `(file:line)` for code citations.”

2. **Project rules**  
   Like Cursor’s rules: support loading **project-specific** instructions (e.g. `.weave/rules/*.md` or a single `WEAVE.md` section). Merge them into the system prompt so the agent follows project conventions (testing, formatting, architecture).

3. **Identity line**  
   Add one clear line at the top, e.g.  
   `You are {name}, {role}. You have access to persistent graph memory and tools for files and shell.`

Implement by extending `AgentMemory.buildSystemPrompt()` with these sections and optional rule files.

---

## 3. Context Attachment (@-style / CWD)

Cursor uses **@ mentions** to attach files, folders, docs, and symbols. In a CLI you don’t have the same UI, but you can approximate:

1. **Explicit context from CWD**  
   - At chat start (or via a slash command), optionally **scan current directory** and attach a short “project context” (e.g. from README, WEAVE.md, package name, top-level dirs) into the system prompt, similar to `/init` but lighter and always available for the session.
   - Or a slash command like **`/context`** that re-runs that scan and refreshes “pinned” context for the next turn.

2. **“Attach file” in the prompt**  
   Allow a special syntax in the user message, e.g. `@path/to/file.ts`, and in `handleSubmit`:
   - Parse such tokens.
   - Read the file (or first N lines) and inject a “User attached: <path>\n```\n...content...\n```” block into the message or system prompt.
   So the model sees “this is the file the user is talking about.”

3. **Recalled memories as “attached”**  
   You already show “recalled N memories” and put them in the system prompt. Optionally format them more like Cursor’s context: e.g. “## Recalled context (use when relevant)\n…” with clear labels so the model knows it’s prior knowledge, not just a wall of text.

These keep your graph memory as the main store but add **explicit, user-visible context** like Cursor’s @.

---

## 4. Memory & Learning (Letta-style)

Letta has:

- **Reflection** (“sleep-time”): background pass over recent conversation to create/update memories.
- **Defrag**: subagent to merge/clean memories.
- **Explicit memory edit**: user says “remember X” and the agent (or a command) writes to memory.

**Improve Weave:**

1. **Smarter extraction**  
   Your `extractMemoryWorthy` is pattern-based. Add:
   - **LLM-based extraction**: optional step where you send the last exchange (user + assistant) to a small/fast model and ask: “List 1–3 concise facts to store for future sessions (preferences, decisions, names, deadlines).” Store each as a memory. This mimics Letta’s “agent decides what to remember.”
   - Keep pattern-based extraction as a fallback when LLM is off or fails.

2. **Reflection / consolidation trigger**  
   Letta runs reflection on “compaction” or every N messages. You already have `consolidate()` (promote, merge, decay, prune). Add:
   - **Periodic consolidation**: e.g. every N user messages or when working memory is full, call `agent.consolidate()` (or a lighter “promote only” pass) so the graph stays healthy without the user running `/compact` manually.
   - Optional: background/sleep-time consolidation (e.g. after session end) so the next session starts with a fresher graph.

3. **Memory visibility**  
   Letta’s `/memory` shows a tree. Your `/memory` shows working memory; `/recall` and `/stats` show search and counts. Consider:
   - **`/memory graph`** or **`/memory list --tier long_term`**: list recent long-term (or archival) memories so the user sees what’s “durable.”
   - **`/forget`** already exists; you could add **`/forget --dry-run`** to show what would be forgotten by a consolidation pass (by importance/age) before running it.

4. **Agent-editable memory**  
   Today only the app (and `/remember`) writes memories. You could add a **tool** the model can call, e.g. `remember_fact(content: string, importance?: number)`, so the agent can write to the graph during the conversation (with optional user approval). That aligns with Letta’s “agent self-edits memory.”

---

## 5. Tools & Safety (Cursor / Claude Code style)

Cursor’s tools are broad (search, edit, run, web, etc.) and the docs stress “use tools when the user asks to examine, edit, or run.” Claude Code CLI is similar: terminal-centric, with file and run capabilities.

**Improve Weave:**

1. **Semantic / codebase search**  
   Add a **`semantic_search`** (or **`codebase_search`**) tool: given a natural-language query, run embedding search over file paths + content chunks (or symbols) and return relevant snippets with paths and line numbers. You already have embeddings in the graph; you could add a separate index over the repo (e.g. under `weave chat` or when `WEAVE.md` exists) or delegate to a simple grep + rank. This matches Cursor’s “find by meaning.”

2. **Tool descriptions in system prompt**  
   In the system block, add one line per tool: when to use it and any constraints (e.g. “read_file: use before editing; use start_line/end_line for large files”). That reduces spurious or wrong tool use.

3. **Approval and safety**  
   You already have per-tool `requiresApproval` and “always allow.” Consider:
   - **Dangerous commands**: block or always-approve list for commands like `rm -rf`, `curl | sh`, etc., and show a clear warning.
   - **CWD**: pass `process.cwd()` (or workspace root) into tool execution so the agent operates in the right directory; document in the tool description that paths are relative to project root.

4. **More tools (optional)**  
   If you want parity with Cursor/Claude Code: **web_search** (e.g. via MCP or a simple API), **apply_patch** (or a second edit strategy) for multi-hunk edits. MCP already extends you; document recommended MCP servers (e.g. filesystem, web) in the README.

---

## 6. UX & Commands (Letta / CLI best practices)

- **Resume vs. new**  
  Letta has `letta` (resume) vs `letta --new`. You have `weave chat` and `/clear` (clear transcript, keep memory). Consider:
  - **`weave chat --new`**: start with empty transcript but same agent/memory (like `/clear` at start).
  - **`weave chat --continue`**: explicitly “resume last session” if you later add conversation persistence (e.g. last transcript id or “continue from last”).

- **Slash command consistency**  
  You have `/init`, `/remember`, `/forget`, `/model`, `/memory`, `/recall`, `/agents`, `/switch`, `/stats`, `/compact`, `/save`, `/clear`, `/exit`. Align with Letta where it helps:
  - **`/new`** as alias for “clear transcript” (like Letta’s new conversation).
  - **`/pin`** (if you add “favorite agents” or “default agent”).
  - **`/memory`** already; consider **`/memory graph`** or **`/memory tiers`** for tier breakdown.

- **Banner and status**  
  Your banner shows agent, model, memory count. Consider showing **workspace** and **provider** so the user knows which backend and DB are in use. Optional: show “MCP: N tools” if MCP is loaded.

- **Headless / automation**  
  Letta has headless mode for scripts. You could add **`weave chat --headless`** or **`weave run <prompt>`**: run one prompt, print the reply, then exit (no interactive REPL). Useful for CI or “weave ask 'what did we decide about X?'”.

---

## 7. Summary: High-Impact Improvements

1. **System prompt**: Add clear identity, tool-use rules, and code-citation format; optionally load `.weave/rules/*.md` or a WEAVE.md “rules” section.
2. **Context**: Add optional “attach file” parsing (`@file`) and/or a lightweight “project context” scan at chat start or via `/context`.
3. **Memory**: Add optional LLM-based memory extraction; periodic or background consolidation; optional `remember_fact` tool; better `/memory` views (e.g. by tier).
4. **Tools**: Add semantic/codebase search; document CWD and safety (dangerous commands); keep and document MCP.
5. **CLI**: Add `--new` / `--continue` semantics, optional `weave run <prompt>` for headless, and surface workspace/provider/MCP in the banner.

Your graph memory is the differentiator; doubling down on **recall quality** (hybrid retrieval, importance, consolidation) and **visibility** (what’s in LTM, what was recalled) will make Weave feel more “agent that remembers” and less “chat with a DB.” The rest brings you closer to Cursor’s and Letta’s UX without losing what makes Weave unique.
