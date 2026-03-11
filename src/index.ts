#!/usr/bin/env node

import { Command } from "commander";
import {
  loadConfig,
  setConfigValue,
  getConfigValue,
  resolveApiKey,
  getWorkspacePath,
  listWorkspaces,
  ensureConfigDir,
} from "./config.js";
import { t, icons, banner, table, successLine, errorLine } from "./ui/theme.js";

const VERSION = "0.4.0";

const program = new Command();

program
  .name("weave-test")
  .description("Testing-native multi-agent CLI with persistent memory")
  .version(VERSION, "-v, --version");

// ── weave chat ─────────────────────────────────────────────
program
  .command("chat")
  .description("Start an interactive chat session with persistent memory")
  .option("-a, --agent <name>", "Agent to chat with", "assistant")
  .option("-m, --model <model>", "Model to use")
  .option("-p, --provider <provider>", "LLM provider (openai|anthropic|ollama|lmstudio)")
  .option("-w, --workspace <name>", "Workspace to use", "default")
  .action(async (options) => {
    const config = loadConfig();
    const provider = options.provider || config.provider;
    const model = options.model || config.model;
    const apiKey = resolveApiKey({ ...config, provider });
    const isLocal = provider === "ollama" || provider === "lmstudio";

    if (!apiKey && !isLocal) {
      console.log("");
      console.log(errorLine("No API key found. Set one with:"));
      console.log(
        `\n  ${t.accent("weave-test config set apiKey")} ${t.dim("<your-api-key>")}`
      );
      console.log(
        `  ${t.dim("or set")} ${t.accent("OPENAI_API_KEY")} ${t.dim("/")} ${t.accent("ANTHROPIC_API_KEY")} ${t.dim("env var")}`
      );
      console.log(
        `  ${t.dim("For OpenAI only: run")} ${t.accent("codex login --api-key <key>")} ${t.dim("then weave-test will use ~/.codex/auth.json")}\n`
      );
      process.exit(1);
    }

    const workspacePath = getWorkspacePath(options.workspace);

    const { MemoryFabric } = await import("./core/fabric.js");
    const { createProvider } = await import("./llm/provider.js");

    const fabric = await MemoryFabric.create({
      ...config,
      provider,
      model,
      apiKey,
      workspacePath,
    });

    const agent = fabric.getOrCreateAgent(options.agent, {
      name: options.agent,
      role: "AI Assistant",
      model,
      provider,
    });

    const baseURL = isLocal && config.baseURL ? config.baseURL : undefined;
    const llm = createProvider(provider, apiKey!, model, baseURL);

    const React = await import("react");
    const { render } = await import("ink");
    const { default: App } = await import("./ui/app.js");

    render(
      React.createElement(App, {
        fabric,
        initialAgent: agent,
        provider: llm,
        model,
        version: VERSION,
      })
    );
  });

// ── weave agent ────────────────────────────────────────────
const agentCmd = program.command("agent").description("Manage agents");

agentCmd
  .command("spawn <name>")
  .description("Create a new agent")
  .option("-r, --role <role>", "Agent role", "AI Assistant")
  .option("-m, --model <model>", "Model to use")
  .option("-d, --description <desc>", "Agent description")
  .action(async (name, options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    fabric.createAgent(name, {
      name,
      role: options.role,
      model: options.model || config.model,
      description: options.description,
    });

    fabric.save();
    fabric.close();
    console.log(successLine(`Agent ${t.agent(name)} created as ${t.dim(options.role)}`));
  });

agentCmd
  .command("list")
  .description("List all agents")
  .action(async () => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const agents = fabric.listAgents();
    if (agents.length === 0) {
      console.log(
        `\n  ${t.dim("No agents yet. Create one with:")} ${t.accent("weave-test agent spawn <name>")}\n`
      );
    } else {
      const rows = agents.map((a) => {
        const stats = a.getMemoryStats();
        return [
          a.persona.name,
          a.persona.role,
          a.persona.model || config.model,
          String(stats.total),
        ];
      });
      console.log("");
      console.log(table(["Name", "Role", "Model", "Memories"], rows));
      console.log("");
    }
    fabric.close();
  });

agentCmd
  .command("inspect <name>")
  .description("Show agent details and memory stats")
  .action(async (name) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const agent = fabric.getAgent(name);
    if (!agent) {
      console.log(errorLine(`Agent "${name}" not found.`));
      fabric.close();
      process.exit(1);
    }

    const stats = agent.getMemoryStats();
    console.log(`\n  ${t.brandBold("Agent: " + agent.persona.name)}`);
    console.log(`  ${t.muted("─".repeat(35))}`);
    console.log(`  ${t.label("Role")}         ${agent.persona.role}`);
    console.log(`  ${t.label("Model")}        ${agent.persona.model || config.model}`);
    if (agent.persona.description) {
      console.log(`  ${t.label("Description")}  ${agent.persona.description}`);
    }
    console.log(`  ${t.muted("─".repeat(35))}`);
    console.log(`  ${t.label("Working")}      ${t.memory(String(stats.working))}`);
    console.log(`  ${t.label("Short-term")}   ${t.memory(String(stats.shortTerm))}`);
    console.log(`  ${t.label("Long-term")}    ${t.memory(String(stats.longTerm))}`);
    console.log(`  ${t.label("Archival")}     ${t.memory(String(stats.archival))}`);
    console.log(`  ${t.label("Total")}        ${t.bold(String(stats.total))}\n`);

    fabric.close();
  });

agentCmd
  .command("kill <name>")
  .description("Remove an agent and all its memories")
  .action(async (name) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    if (fabric.removeAgent(name)) {
      fabric.save();
      console.log(successLine(`Agent "${name}" removed.`));
    } else {
      console.log(errorLine(`Agent "${name}" not found.`));
    }
    fabric.close();
  });

// ── weave memory ───────────────────────────────────────────
const memoryCmd = program.command("memory").description("Manage memories");

memoryCmd
  .command("add <content>")
  .description("Add a memory manually")
  .option("-a, --agent <name>", "Target agent", "assistant")
  .option("-i, --importance <n>", "Importance 0-1", "0.6")
  .action(async (content, options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const agent = fabric.getOrCreateAgent(options.agent, {
      name: options.agent,
      role: "AI Assistant",
    });

    const id = await agent.add(content, {
      importance: parseFloat(options.importance),
    });

    fabric.save();
    fabric.close();
    console.log(successLine(`Memory added ${t.dim(`(${id})`)}`));
  });

memoryCmd
  .command("search <query>")
  .description("Search memories across agents")
  .option("-a, --agent <name>", "Filter by agent")
  .option("-k, --top <n>", "Number of results", "10")
  .action(async (query, options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    let results;
    if (options.agent) {
      const agent = fabric.getAgent(options.agent);
      if (!agent) {
        console.log(errorLine(`Agent "${options.agent}" not found.`));
        fabric.close();
        process.exit(1);
      }
      results = await agent.recall(query, parseInt(options.top));
    } else {
      results = await fabric.queryAcrossAgents(query, parseInt(options.top));
    }

    if (results.length === 0) {
      console.log(`\n  ${t.dim("No memories found.")}\n`);
    } else {
      console.log(
        `\n  ${t.brandBold("Search Results")} ${t.dim(`(${results.length} found)`)}`
      );
      console.log(`  ${t.muted("─".repeat(50))}`);
      for (const r of results) {
        const score = t.memory(`[${r.score.toFixed(3)}]`);
        const agentLabel = t.dim(`@${r.node.agentId}`);
        const tier = t.muted(r.node.tier);
        console.log(`  ${score} ${r.node.content}`);
        console.log(`       ${agentLabel} ${t.muted(icons.dot)} ${tier}`);
      }
      console.log("");
    }

    fabric.close();
  });

memoryCmd
  .command("list")
  .description("List recent memories")
  .option("-a, --agent <name>", "Filter by agent")
  .option("-n, --limit <n>", "Number of results", "20")
  .action(async (options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const graph = fabric.getGraph();
    let nodes = graph.getAllNodes();

    if (options.agent) {
      nodes = nodes.filter((n) => n.agentId === options.agent);
    }

    nodes.sort((a, b) => b.createdAt - a.createdAt);
    nodes = nodes.slice(0, parseInt(options.limit));

    if (nodes.length === 0) {
      console.log(`\n  ${t.dim("No memories found.")}\n`);
    } else {
      console.log(`\n  ${t.brandBold("Recent Memories")}`);
      console.log(`  ${t.muted("─".repeat(50))}`);
      for (const node of nodes) {
        const age = timeSince(node.createdAt);
        const imp = t.memory(`[${node.importance.toFixed(2)}]`);
        const agentLabel = t.dim(`@${node.agentId}`);
        const content =
          node.content.length > 65
            ? node.content.substring(0, 65) + "..."
            : node.content;
        console.log(`  ${imp} ${content}`);
        console.log(
          `       ${agentLabel} ${t.muted(icons.dot)} ${t.muted(node.tier)} ${t.muted(icons.dot)} ${t.muted(age)}`
        );
      }
      console.log("");
    }

    fabric.close();
  });

memoryCmd
  .command("consolidate")
  .description("Run memory consolidation (promote, merge, decay, prune)")
  .action(async () => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath();

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const graph = fabric.getGraph();
    const result = graph.consolidate();

    fabric.save();
    fabric.close();

    console.log(`\n  ${t.brandBold("Consolidation Complete")}`);
    console.log(`  ${t.success(icons.check)} Promoted:  ${result.promoted}`);
    console.log(`  ${t.success(icons.check)} Merged:    ${result.merged}`);
    console.log(`  ${t.success(icons.check)} Decayed:   ${result.decayed}`);
    console.log(`  ${t.success(icons.check)} Pruned:    ${result.pruned}\n`);
  });

// ── weave test ─────────────────────────────────────────────
const testCmd = program.command("test").description("Testing-focused multi-agent workflow");

testCmd
  .command("init")
  .description("Create default testing agents")
  .option("-w, --workspace <name>", "Workspace to use", "default")
  .action(async (options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath(options.workspace);

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });

    const defaults = [
      {
        id: "test-orchestrator",
        name: "test-orchestrator",
        role: "QA Orchestrator",
        description: "Coordinates multi-step test execution and prioritizes fixes by risk.",
      },
      {
        id: "edge-case-hunter",
        name: "edge-case-hunter",
        role: "Edge Case Hunter",
        description: "Finds negative, boundary, race-condition, and regression edge cases.",
      },
      {
        id: "report-analyst",
        name: "report-analyst",
        role: "Test Report Analyst",
        description: "Turns noisy test output into actionable summaries and next steps.",
      },
    ];

    for (const persona of defaults) {
      fabric.getOrCreateAgent(persona.id, persona);
    }
    fabric.save();
    fabric.close();
    console.log(successLine("Testing agents initialized."));
  });

testCmd
  .command("plan")
  .description("Show discovered and autonomous testing plan without executing")
  .option("-d, --dir <path>", "Target project directory", process.cwd())
  .option("-m, --model <model>", "Model to use for autonomous planning")
  .option("-p, --provider <provider>", "LLM provider (openai|anthropic|ollama|lmstudio)")
  .option("--max-auto <n>", "Maximum autonomous test commands to add (0 disables)", "0")
  .option("--no-autonomous", "Disable autonomous test expansion")
  .action(async (options) => {
    const config = loadConfig();
    const providerName = options.provider || config.provider;
    const model = options.model || config.model;
    const apiKey = resolveApiKey({ ...config, provider: providerName });
    const isLocal = providerName === "ollama" || providerName === "lmstudio";
    const targetDir = String(options.dir);
    const maxAutonomous = Math.max(0, parseInt(String(options.maxAuto), 10) || 0);
    const autonomousEnabled = Boolean(options.autonomous);

    const { discoverTestingPlan } = await import("./testing/discovery.js");
    const { generateAutonomousPlan, toAutonomousCommands } = await import("./testing/autonomous.js");
    const { createProvider } = await import("./llm/provider.js");
    const plan = discoverTestingPlan(targetDir);

    if (plan.commands.length === 0) {
      console.log(errorLine("No test commands discovered for this project."));
      process.exit(1);
    }

    const llm = apiKey || isLocal
      ? createProvider(providerName, apiKey || "ollama", model, config.baseURL)
      : null;
    const autonomousItems =
      autonomousEnabled && maxAutonomous > 0
        ? await generateAutonomousPlan(llm, model, plan, maxAutonomous)
        : [];
    const autonomousCommands = toAutonomousCommands(autonomousItems, plan.commands);

    console.log(`\n  ${t.brandBold("Testing plan")}`);
    console.log(`  ${t.muted("─".repeat(50))}`);
    for (const cmd of plan.commands) {
      console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
    }
    if (autonomousCommands.length > 0) {
      console.log(`  ${t.brandBold("Autonomous additions")}`);
      for (const cmd of autonomousCommands) {
        console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
      }
    }
    console.log("");
  });

testCmd
  .command("run")
  .description("Run discovered + autonomous tests, analyze results, and persist findings")
  .option("-w, --workspace <name>", "Workspace to use", "default")
  .option("-d, --dir <path>", "Target project directory", process.cwd())
  .option("-m, --model <model>", "Model to use for testing insights")
  .option("-p, --provider <provider>", "LLM provider (openai|anthropic|ollama|lmstudio)")
  .option("-t, --timeout <ms>", "Per-command timeout in milliseconds", "120000")
  .option("--max-auto <n>", "Maximum autonomous test commands to add (0 disables)", "0")
  .option("--no-autonomous", "Disable autonomous test expansion")
  .action(async (options) => {
    const config = loadConfig();
    const providerName = options.provider || config.provider;
    const model = options.model || config.model;
    const apiKey = resolveApiKey({ ...config, provider: providerName });
    const isLocal = providerName === "ollama" || providerName === "lmstudio";
    const workspacePath = getWorkspacePath(options.workspace);

    const { MemoryFabric } = await import("./core/fabric.js");
    const { discoverTestingPlan } = await import("./testing/discovery.js");
    const { runTestingCommands } = await import("./testing/runner.js");
    const {
      generateAutonomousPlan,
      toAutonomousCommands,
      persistAutonomousPlan,
    } = await import("./testing/autonomous.js");
    const {
      buildTestingInsights,
      makeTestingReport,
      persistRunToMemory,
    } = await import("./testing/orchestrator.js");
    const { renderTestingReport } = await import("./testing/report.js");
    const { createProvider } = await import("./llm/provider.js");

    const fabric = await MemoryFabric.create({
      ...config,
      provider: providerName,
      model,
      apiKey,
      workspacePath,
    });

    const orchestrator = fabric.getOrCreateAgent("test-orchestrator", {
      name: "test-orchestrator",
      role: "QA Orchestrator",
      description: "Coordinates multi-step test execution and prioritizes fixes by risk.",
      model,
      provider: providerName,
    });
    const edgeHunter = fabric.getOrCreateAgent("edge-case-hunter", {
      name: "edge-case-hunter",
      role: "Edge Case Hunter",
      description: "Finds negative, boundary, race-condition, and regression edge cases.",
      model,
      provider: providerName,
    });
    const reporter = fabric.getOrCreateAgent("report-analyst", {
      name: "report-analyst",
      role: "Test Report Analyst",
      description: "Turns noisy test output into actionable summaries and next steps.",
      model,
      provider: providerName,
    });

    const targetDir = String(options.dir);
    const timeoutMs = parseInt(String(options.timeout), 10);
    const maxAutonomous = Math.max(0, parseInt(String(options.maxAuto), 10) || 0);
    const autonomousEnabled = Boolean(options.autonomous);
    const plan = discoverTestingPlan(targetDir);

    if (plan.commands.length === 0) {
      console.log(errorLine("No test commands discovered for this project."));
      console.log(`  ${t.dim("Use scripts like test/lint/typecheck/build in package.json, then rerun.")}`);
      fabric.close();
      process.exit(1);
    }

    console.log(`\n  ${t.brandBold("Running testing pipeline")}`);
    console.log(`  ${t.muted("─".repeat(40))}`);
    for (const cmd of plan.commands) {
      console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
    }
    const llm = apiKey || isLocal
      ? createProvider(providerName, apiKey || "ollama", model, config.baseURL)
      : null;

    const autonomousItems =
      autonomousEnabled && maxAutonomous > 0
        ? await generateAutonomousPlan(llm, model, plan, maxAutonomous)
        : [];
    const autonomousCommands = toAutonomousCommands(autonomousItems, plan.commands);
    if (autonomousCommands.length > 0) {
      console.log(`  ${t.brandBold("Autonomous expansions")}`);
      for (const cmd of autonomousCommands) {
        console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
      }
      await persistAutonomousPlan(orchestrator, edgeHunter, autonomousItems);
    }
    console.log("");

    const results = runTestingCommands(
      [...plan.commands, ...autonomousCommands],
      targetDir,
      timeoutMs
    );
    const insights = await buildTestingInsights(llm, model, plan, results);
    const report = makeTestingReport(targetDir, plan, results, insights);

    await persistRunToMemory(orchestrator, edgeHunter, reporter, report);
    fabric.save();
    fabric.close();

    console.log(renderTestingReport(report));
  });

// ── weave config ───────────────────────────────────────────
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key, value) => {
    try {
      setConfigValue(key, value);
      console.log(successLine(`${key} = ${t.accent(value)}`));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key) => {
    const value = getConfigValue(key);
    if (value === undefined) {
      console.log(t.dim(`  ${key} is not set`));
    } else {
      const display = key.toLowerCase().includes("key")
        ? String(value).substring(0, 8) + "..."
        : String(value);
      console.log(`  ${t.label(key)} = ${display}`);
    }
  });

configCmd
  .command("list")
  .description("Show all config")
  .action(() => {
    const config = loadConfig();
    console.log(`\n  ${t.brandBold("Configuration")}`);
    console.log(`  ${t.muted("─".repeat(40))}`);
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      const display =
        key.toLowerCase().includes("key") && typeof value === "string"
          ? value.substring(0, 8) + "..."
          : String(value);
      console.log(`  ${t.label(key.padEnd(18))} ${display}`);
    }
    console.log("");
  });

// ── weave workspace ────────────────────────────────────────
const wsCmd = program
  .command("workspace")
  .description("Manage workspaces");

wsCmd
  .command("list")
  .description("List all workspaces")
  .action(() => {
    const workspaces = listWorkspaces();
    if (workspaces.length === 0) {
      console.log(
        `\n  ${t.dim("No workspaces. Start chatting to create one!")}\n`
      );
    } else {
      console.log(`\n  ${t.brandBold("Workspaces")}`);
      for (const w of workspaces) {
        console.log(`  ${t.muted(icons.pipe)} ${t.accent(w)}`);
      }
      console.log("");
    }
  });

wsCmd
  .command("create <name>")
  .description("Create a new workspace")
  .action(async (name) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath(name);

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });
    fabric.close();

    console.log(successLine(`Workspace ${t.accent(name)} created.`));
  });

// ── weave web ──────────────────────────────────────────────
program
  .command("web")
  .description("Open the memory graph viewer in your browser")
  .option("-p, --port <port>", "Port number", "3333")
  .option("-w, --workspace <name>", "Workspace to visualize", "default")
  .action(async (options) => {
    const config = loadConfig();
    const workspacePath = getWorkspacePath(options.workspace);

    const { MemoryFabric } = await import("./core/fabric.js");
    const fabric = await MemoryFabric.create({ ...config, workspacePath });
    const stats = fabric.getStats();

    console.log(banner(VERSION));
    console.log(successLine(`Memory graph: ${stats.nodes} nodes, ${stats.edges} edges`));

    const { startWebViewer } = await import("./web/server.js");
    await startWebViewer(fabric, parseInt(options.port));

    console.log(`\n  ${t.dim("Press Ctrl+C to stop the server.")}\n`);
  });

// ── weave doctor ───────────────────────────────────────────
program
  .command("doctor")
  .description("Check system health and memory diagnostics")
  .action(async () => {
    console.log(`\n  ${t.brandBold("Weave Doctor")}`);
    console.log(`  ${t.muted("─".repeat(40))}`);

    const config = loadConfig();
    const apiKey = resolveApiKey(config);
    const isLocal = config.provider === "ollama" || config.provider === "lmstudio";
    const apiKeyOk = isLocal || apiKey;
    console.log(
      `  ${apiKeyOk ? t.success(icons.check) : t.error(icons.cross)} API Key: ${isLocal ? t.success("not required (local)") : apiKey ? t.success("configured") : t.error("missing")}`
    );
    console.log(`  ${t.success(icons.check)} Provider: ${config.provider}`);
    if (isLocal && config.baseURL) {
      console.log(`  ${t.success(icons.check)} Base URL: ${config.baseURL}`);
    }
    console.log(`  ${t.success(icons.check)} Model: ${config.model}`);
    console.log(
      `  ${t.success(icons.check)} Embedding: ${config.embeddingBackend} (${config.embeddingDim}d)`
    );

    const workspaces = listWorkspaces();
    console.log(
      `  ${t.success(icons.check)} Workspaces: ${workspaces.length || "none"}`
    );

    try {
      await import("better-sqlite3");
      console.log(`  ${t.success(icons.check)} SQLite: ${t.success("available")}`);
    } catch {
      console.log(`  ${t.error(icons.cross)} SQLite: ${t.error("not installed")}`);
    }

    if (workspaces.length > 0) {
      const workspacePath = getWorkspacePath(workspaces[0]);
      const { MemoryFabric } = await import("./core/fabric.js");
      const fabric = await MemoryFabric.create({ ...config, workspacePath });
      const stats = fabric.getStats();

      console.log(`  ${t.muted("─".repeat(40))}`);
      console.log(`  ${t.label("Fabric Stats")}`);
      console.log(`  ${t.muted(icons.pipe)} Agents: ${stats.agents}`);
      console.log(`  ${t.muted(icons.pipe)} Memory nodes: ${stats.nodes}`);
      console.log(`  ${t.muted(icons.pipe)} Memory edges: ${stats.edges}`);

      fabric.close();
    }

    console.log(`\n  ${t.success("All checks passed!")}\n`);
  });

// ── weave init ─────────────────────────────────────────────
program
  .command("init")
  .description("Initialize weave-test in the current directory")
  .action(() => {
    ensureConfigDir();
    console.log(banner(VERSION));
    console.log(successLine("Weave initialized!"));
    console.log(`\n  ${t.dim("Get started:")}`);
    console.log(
      `  ${t.accent("weave-test config set apiKey")} ${t.dim("<your-api-key>")}  ${t.muted("# set your API key")}`
    );
    console.log(
      `  ${t.accent("weave-test test init")}                    ${t.muted("# bootstrap testing agents")}`
    );
    console.log(
      `  ${t.accent("weave-test test run")}                     ${t.muted("# run testing workflow")}`
    );
    console.log("");
  });

// ── Default action ─────────────────────────────────────────
program.action(() => {
  console.log(banner(VERSION));
  program.outputHelp();
});

program.parse();

function timeSince(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
