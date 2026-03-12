#!/usr/bin/env node

import * as path from "node:path";
import { Command } from "commander";
import {
  loadConfig,
  saveConfig,
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
    try {
      const { planTestWorkflow } = await import("./testing/run-workflow.js");
      const targetDir = String(options.dir);
      const maxAutonomous = Math.max(0, parseInt(String(options.maxAuto), 10) || 0);
      const autonomousEnabled = Boolean(options.autonomous);
      const plan = await planTestWorkflow({
        workspace: "default",
        dir: targetDir,
        model: options.model,
        provider: options.provider,
        maxAuto: maxAutonomous,
        autonomous: autonomousEnabled,
      });

      console.log(`\n  ${t.brandBold("Testing plan")}`);
      console.log(`  ${t.muted("─".repeat(50))}`);
      for (const cmd of plan.discoveredCommands) {
        console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
      }
      if (plan.autonomousCommands.length > 0) {
        console.log(`  ${t.brandBold("Autonomous additions")}`);
        for (const cmd of plan.autonomousCommands) {
          console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
        }
      }
      console.log("");
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
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
    try {
      const { executeTestWorkflow } = await import("./testing/run-workflow.js");
      const targetDir = String(options.dir);
      const timeoutMs = parseInt(String(options.timeout), 10);
      const maxAutonomous = Math.max(0, parseInt(String(options.maxAuto), 10) || 0);
      const autonomousEnabled = Boolean(options.autonomous);

      const result = await executeTestWorkflow({
        workspace: options.workspace,
        dir: targetDir,
        model: options.model,
        provider: options.provider,
        timeoutMs,
        maxAuto: maxAutonomous,
        autonomous: autonomousEnabled,
      });

      console.log(`\n  ${t.brandBold("Running testing pipeline")}`);
      console.log(`  ${t.muted("─".repeat(40))}`);
      for (const cmd of result.discoveredCommands) {
        console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
      }
      if (result.autonomousCommands.length > 0) {
        console.log(`  ${t.brandBold("Autonomous expansions")}`);
        for (const cmd of result.autonomousCommands) {
          console.log(`  ${t.muted(icons.arrow)} ${cmd.label} ${t.dim(`(${cmd.command})`)}`);
        }
      }
      console.log("");
      console.log(result.renderedReport);
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── weave-test automation ─────────────────────────────────
const automationCmd = program
  .command("automation")
  .description("Durable automations for recurring testing workflows");

automationCmd
  .command("create")
  .description("Create a durable automation")
  .requiredOption("-n, --name <name>", "Automation name")
  .requiredOption("-d, --dir <path>", "Target project directory")
  .option("-w, --workspace <name>", "Workspace to store and run in", "default")
  .option("--target <type>", "Automation target (testRun|testPlan)", "testRun")
  .option("--every <interval>", "Recurring interval like 15m, 2h, or 1d")
  .option("--cron <expr>", "5-field cron expression")
  .option("--at <time>", "One-shot reminder time like `in 45 minutes` or an ISO date")
  .option("-t, --timeout <ms>", "Per-command timeout in milliseconds", "120000")
  .option("--max-auto <n>", "Maximum autonomous test commands to add", "0")
  .option("--no-autonomous", "Disable autonomous expansion")
  .option("--max-failures <n>", "Auto-pause after this many consecutive failures", "3")
  .option("-m, --model <model>", "Model to use")
  .option("-p, --provider <provider>", "Provider to use")
  .action(async (options) => {
    try {
      const { AutomationStore } = await import("./testing/automation-store.js");
      const {
        buildAutomationTarget,
        buildAutomationTrigger,
        renderAutomationCreated,
      } = await import("./testing/automation-cli.js");
      const store = await AutomationStore.create(options.workspace);
      const trigger = buildAutomationTrigger({
        every: options.every,
        cron: options.cron,
        at: options.at,
      });
      const target = buildAutomationTarget({
        target: options.target,
        dir: options.dir,
        workspace: options.workspace,
        timeout: options.timeout,
        maxAuto: options.maxAuto,
        autonomous: options.autonomous,
        provider: options.provider,
        model: options.model,
      });
      const record = store.create({
        name: options.name,
        trigger,
        target,
        maxFailures: Math.max(1, parseInt(String(options.maxFailures), 10) || 3),
      });
      console.log(renderAutomationCreated(record));
      store.close();
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

automationCmd
  .command("list")
  .description("List automations")
  .option("-w, --workspace <name>", "Workspace to inspect", "default")
  .action(async (options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const { renderAutomationTable } = await import("./testing/automation-cli.js");
    const store = await AutomationStore.create(options.workspace);
    const records = store.list();
    if (records.length === 0) {
      console.log(`\n  ${t.dim("No automations yet. Create one with:")} ${t.accent("weave-test automation create")}\n`);
    } else {
      console.log("");
      console.log(renderAutomationTable(records));
      console.log("");
    }
    store.close();
  });

automationCmd
  .command("delete <id>")
  .description("Delete an automation")
  .option("-w, --workspace <name>", "Workspace to modify", "default")
  .action(async (id, options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const store = await AutomationStore.create(options.workspace);
    const record = store.get(id);
    if (!record) {
      console.log(errorLine(`Automation "${id}" not found.`));
      store.close();
      process.exit(1);
    }
    store.delete(id);
    store.close();
    console.log(successLine(`Automation "${id}" deleted.`));
  });

automationCmd
  .command("pause <id>")
  .description("Pause an automation")
  .option("-w, --workspace <name>", "Workspace to modify", "default")
  .action(async (id, options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const store = await AutomationStore.create(options.workspace);
    const updated = store.setEnabled(id, false);
    store.close();
    if (!updated) {
      console.log(errorLine(`Automation "${id}" not found.`));
      process.exit(1);
    }
    console.log(successLine(`Automation "${id}" paused.`));
  });

automationCmd
  .command("resume <id>")
  .description("Resume an automation")
  .option("-w, --workspace <name>", "Workspace to modify", "default")
  .action(async (id, options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const { computeNextRunAt } = await import("./testing/automation-store.js");
    const store = await AutomationStore.create(options.workspace);
    const record = store.get(id);
    if (!record) {
      store.close();
      console.log(errorLine(`Automation "${id}" not found.`));
      process.exit(1);
    }
    record.enabled = true;
    record.failureCount = 0;
    record.nextRunAt = record.nextRunAt ?? computeNextRunAt(record.trigger);
    store.save(record);
    store.close();
    console.log(successLine(`Automation "${id}" resumed.`));
  });

automationCmd
  .command("run <id>")
  .description("Run an automation immediately")
  .option("-w, --workspace <name>", "Workspace to load from", "default")
  .action(async (id, options) => {
    try {
      const { AutomationStore } = await import("./testing/automation-store.js");
      const { executeTestWorkflow, planTestWorkflow } = await import("./testing/run-workflow.js");
      const store = await AutomationStore.create(options.workspace);
      const record = store.get(id);
      if (!record) {
        store.close();
        console.log(errorLine(`Automation "${id}" not found.`));
        process.exit(1);
      }

      const runId = `${record.id}-manual-${Date.now()}`;
      const startedAt = Date.now();
      store.appendRun({
        id: runId,
        automationId: record.id,
        startedAt,
        status: "running",
        summary: "Manual automation run started.",
      });

      if (record.target.type === "testPlan") {
        const planned = await planTestWorkflow({
          workspace: record.target.workspace,
          dir: record.target.dir,
          model: record.target.model,
          provider: record.target.provider,
          timeoutMs: record.target.timeoutMs,
          maxAuto: record.target.maxAuto,
          autonomous: record.target.autonomous,
        });
        const summary = `Plan generated with ${planned.discoveredCommands.length} discovered and ${planned.autonomousCommands.length} autonomous commands.`;
        store.completeRun(record, runId, startedAt, "passed", summary, Date.now());
        console.log(successLine(summary));
      } else {
        const result = await executeTestWorkflow({
          workspace: record.target.workspace,
          dir: record.target.dir,
          model: record.target.model,
          provider: record.target.provider,
          timeoutMs: record.target.timeoutMs,
          maxAuto: record.target.maxAuto,
          autonomous: record.target.autonomous,
        });
        const failed = result.report.results.filter((item) => !item.passed).length;
        store.completeRun(
          record,
          runId,
          startedAt,
          failed === 0 ? "passed" : "failed",
          failed === 0
            ? "Automation completed successfully."
            : `Automation completed with ${failed} failing command(s).`,
          Date.now()
        );
        console.log(result.renderedReport);
      }

      store.close();
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

automationCmd
  .command("daemon")
  .description("Run the automation scheduler")
  .option("-w, --workspace <name>", "Workspace to watch", "default")
  .option("--poll-ms <n>", "Polling interval in milliseconds", "10000")
  .action(async (options) => {
    if (process.env.WEAVE_TEST_DISABLE_AUTOMATIONS === "1") {
      console.log(errorLine("Automations are disabled by WEAVE_TEST_DISABLE_AUTOMATIONS=1"));
      process.exit(1);
    }
    const { AutomationStore } = await import("./testing/automation-store.js");
    const { renderSchedulerHeartbeat } = await import("./testing/automation-cli.js");
    const { AutomationScheduler } = await import("./testing/scheduler.js");
    const pollMs = Math.max(1000, parseInt(String(options.pollMs), 10) || 10000);
    const store = await AutomationStore.create(options.workspace);
    const scheduler = new AutomationScheduler(store, {
      pollMs,
      logger: (message) => console.log(`  ${t.dim(message)}`),
    });

    console.log("");
    console.log(renderSchedulerHeartbeat(options.workspace, pollMs));
    console.log(`  ${t.dim("Press Ctrl+C to stop.")}`);
    console.log("");

    scheduler.start();
    process.on("SIGINT", () => {
      scheduler.stop();
      store.close();
      process.exit(0);
    });
  });

automationCmd
  .command("remind <when>")
  .description("Create a one-time reminder automation")
  .requiredOption("-n, --name <name>", "Automation name")
  .requiredOption("-d, --dir <path>", "Target project directory")
  .option("-w, --workspace <name>", "Workspace to store and run in", "default")
  .option("--target <type>", "Automation target (testRun|testPlan)", "testRun")
  .option("-t, --timeout <ms>", "Per-command timeout in milliseconds", "120000")
  .option("--max-auto <n>", "Maximum autonomous test commands to add", "0")
  .option("--no-autonomous", "Disable autonomous expansion")
  .option("-m, --model <model>", "Model to use")
  .option("-p, --provider <provider>", "Provider to use")
  .action(async (when, options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const {
      buildAutomationTarget,
      buildAutomationTrigger,
      renderAutomationCreated,
    } = await import("./testing/automation-cli.js");
    const store = await AutomationStore.create(options.workspace);
    const record = store.create({
      name: options.name,
      trigger: buildAutomationTrigger({ at: when }),
      target: buildAutomationTarget({
        target: options.target,
        dir: options.dir,
        workspace: options.workspace,
        timeout: options.timeout,
        maxAuto: options.maxAuto,
        autonomous: options.autonomous,
        provider: options.provider,
        model: options.model,
      }),
      maxFailures: 1,
    });
    console.log(renderAutomationCreated(record));
    store.close();
  });

automationCmd
  .command("loop <interval>")
  .description("Create a recurring automation with a Claude-style shortcut")
  .requiredOption("-n, --name <name>", "Automation name")
  .requiredOption("-d, --dir <path>", "Target project directory")
  .option("-w, --workspace <name>", "Workspace to store and run in", "default")
  .option("--target <type>", "Automation target (testRun|testPlan)", "testRun")
  .option("-t, --timeout <ms>", "Per-command timeout in milliseconds", "120000")
  .option("--max-auto <n>", "Maximum autonomous test commands to add", "0")
  .option("--no-autonomous", "Disable autonomous expansion")
  .option("--max-failures <n>", "Auto-pause after this many consecutive failures", "3")
  .option("-m, --model <model>", "Model to use")
  .option("-p, --provider <provider>", "Provider to use")
  .action(async (interval, options) => {
    const { AutomationStore } = await import("./testing/automation-store.js");
    const {
      buildAutomationTarget,
      buildAutomationTrigger,
      renderAutomationCreated,
    } = await import("./testing/automation-cli.js");
    const store = await AutomationStore.create(options.workspace);
    const record = store.create({
      name: options.name,
      trigger: buildAutomationTrigger({ every: interval }),
      target: buildAutomationTarget({
        target: options.target,
        dir: options.dir,
        workspace: options.workspace,
        timeout: options.timeout,
        maxAuto: options.maxAuto,
        autonomous: options.autonomous,
        provider: options.provider,
        model: options.model,
      }),
      maxFailures: Math.max(1, parseInt(String(options.maxFailures), 10) || 3),
    });
    console.log(renderAutomationCreated(record));
    store.close();
  });

// ── weave-test github ─────────────────────────────────────
const githubCmd = program.command("github").description("GitHub-backed repository actions");
const githubAuthCmd = githubCmd.command("auth").description("Choose how GitHub writes authenticate");

const githubAppCmd = githubCmd.command("app").description("Manage GitHub App configuration");

githubAuthCmd
  .command("use-app")
  .description("Use GitHub App auth for future GitHub commands")
  .action(() => {
    saveConfig({ githubAuthMode: "app" });
    console.log(successLine("GitHub auth mode set to app."));
  });

githubAuthCmd
  .command("use-bot")
  .description("Use a bot token for future GitHub commands")
  .option("--username <name>", "Bot GitHub username")
  .action((options) => {
    saveConfig({
      githubAuthMode: "token",
      githubBotUsername: options.username,
    });
    console.log(successLine("GitHub auth mode set to token."));
    if (!process.env.WEAVE_TEST_GITHUB_BOT_TOKEN && !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      console.log("");
      console.log(errorLine("Set WEAVE_TEST_GITHUB_BOT_TOKEN (or GITHUB_TOKEN / GH_TOKEN) before using token mode."));
    }
  });

githubAuthCmd
  .command("status")
  .description("Show the currently selected GitHub auth mode")
  .action(async () => {
    try {
      const config = loadConfig();
      const { getGithubAuthStatus } = await import("./github/write-flow.js");
      const { renderGithubAuthStatus } = await import("./github/cli.js");
      console.log(renderGithubAuthStatus(getGithubAuthStatus(config)));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

githubAppCmd
  .command("init")
  .description("Save GitHub App configuration")
  .requiredOption("--app-id <id>", "GitHub App ID")
  .option("--private-key-path <path>", "Path to GitHub App private key PEM file")
  .option("--owner <owner>", "Default GitHub owner/org")
  .option("--repo <repo>", "Default GitHub repository")
  .option("--api-base-url <url>", "GitHub API base URL")
  .action((options) => {
    if (!options.privateKeyPath && !process.env.GITHUB_APP_PRIVATE_KEY) {
      console.log(errorLine("Provide --private-key-path or set GITHUB_APP_PRIVATE_KEY."));
      process.exit(1);
    }
    saveConfig({
      githubAppId: options.appId,
      githubAppPrivateKeyPath: options.privateKeyPath,
      githubOwner: options.owner,
      githubRepo: options.repo,
      githubApiBaseUrl: options.apiBaseUrl,
    });
    console.log(successLine("GitHub App configuration saved."));
  });

githubAppCmd
  .command("status")
  .description("Verify GitHub App auth and show current defaults")
  .action(async () => {
    try {
      const config = loadConfig();
      const { getGithubAppStatus } = await import("./github/write-flow.js");
      const { renderGithubStatus } = await import("./github/cli.js");
      const status = await getGithubAppStatus(config);
      console.log(renderGithubStatus(status));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

const githubRepoCmd = githubCmd.command("repo").description("Inspect and connect repositories");
const githubBranchCmd = githubCmd.command("branch").description("Branch actions");

githubRepoCmd
  .command("connect")
  .description("Verify repo access and optionally save defaults")
  .requiredOption("--owner <owner>", "GitHub owner/org")
  .requiredOption("--repo <repo>", "GitHub repository")
  .option("--save-defaults", "Save owner/repo as defaults")
  .action(async (options) => {
    try {
      const config = loadConfig();
      const { listConnectedRepos } = await import("./github/write-flow.js");
      const { renderGithubRepos } = await import("./github/cli.js");
      const repos = await listConnectedRepos(config, options.owner, options.repo);
      const match = repos.find((repo) => repo.full_name === `${options.owner}/${options.repo}`);
      if (!match) {
        console.log(errorLine(`GitHub access is not configured for ${options.owner}/${options.repo}.`));
        process.exit(1);
      }
      if (options.saveDefaults) {
        saveConfig({ githubOwner: options.owner, githubRepo: options.repo });
      }
      console.log("");
      console.log(renderGithubRepos([match]));
      console.log("");
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

githubBranchCmd
  .command("create")
  .description("Create a branch through the configured GitHub auth mode")
  .requiredOption("--branch <name>", "Branch name to create")
  .option("--base <branch>", "Base branch")
  .option("--owner <owner>", "GitHub owner/org")
  .option("--repo <repo>", "GitHub repository")
  .action(async (options) => {
    try {
      const config = loadConfig();
      const { createGithubBranch } = await import("./github/write-flow.js");
      const { renderBranchCreated } = await import("./github/cli.js");
      const result = await createGithubBranch(config, {
        owner: options.owner,
        repo: options.repo,
        branch: options.branch,
        baseBranch: options.base,
      });
      console.log(renderBranchCreated(result));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

async function handleGithubCommitLike(
  options: {
    owner?: string;
    repo?: string;
    branch: string;
    message: string;
    dir: string;
    paths: string[];
  }
): Promise<void> {
  const config = loadConfig();
  const { createGithubCommitFromFiles } = await import("./github/write-flow.js");
  const { renderCommitResult } = await import("./github/cli.js");
  const result = await createGithubCommitFromFiles(config, {
    owner: options.owner,
    repo: options.repo,
    branch: options.branch,
    message: options.message,
    dir: options.dir,
    filePaths: options.paths,
  });
  console.log(renderCommitResult(result));
}

async function handleGithubWorktreePush(
  options: {
    owner?: string;
    repo?: string;
    branch: string;
    message: string;
    dir: string;
    createBranchIfMissing?: boolean;
    base?: string;
  }
): Promise<void> {
  const config = loadConfig();
  const { pushGithubWorktree } = await import("./github/write-flow.js");
  const { renderCommitResult } = await import("./github/cli.js");
  const result = await pushGithubWorktree(config, {
    owner: options.owner,
    repo: options.repo,
    branch: options.branch,
    message: options.message,
    dir: options.dir,
    createBranchIfMissing: options.createBranchIfMissing,
    baseBranch: options.base,
  });
  console.log(renderCommitResult(result));
}

githubCmd
  .command("commit")
  .description("Create a commit on a GitHub branch from local files")
  .requiredOption("--branch <name>", "Target branch name")
  .requiredOption("--message <text>", "Commit message")
  .requiredOption("--dir <path>", "Local project directory")
  .option("--owner <owner>", "GitHub owner/org")
  .option("--repo <repo>", "GitHub repository")
  .argument("<paths...>", "Files relative to --dir to include")
  .action(async (paths, options) => {
    try {
      await handleGithubCommitLike({ ...options, paths });
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

githubCmd
  .command("push")
  .description("Push current local git worktree changes to a branch")
  .requiredOption("--branch <name>", "Target branch name")
  .requiredOption("--message <text>", "Commit message")
  .requiredOption("--dir <path>", "Local project directory")
  .option("--owner <owner>", "GitHub owner/org")
  .option("--repo <repo>", "GitHub repository")
  .option("--create-branch-if-missing", "Create the branch first if it does not exist")
  .option("--base <branch>", "Base branch when creating a missing branch")
  .action(async (options) => {
    try {
      await handleGithubWorktreePush({
        ...options,
        createBranchIfMissing: options.createBranchIfMissing,
      });
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

githubCmd
  .command("bot-push")
  .description("Commit as the bot identity and push (like Cursor / Claude Code)")
  .requiredOption("--branch <name>", "Target branch name")
  .requiredOption("--message <text>", "Commit message")
  .option("--dir <path>", "Local project directory", ".")
  .option("--bot-username <name>", "Bot GitHub username", "weave-cli")
  .action(async (options) => {
    try {
      const { gitCommitAndPushAsBot } = await import("./github/write-flow.js");
      const { renderBotPushResult } = await import("./github/cli.js");
      const result = gitCommitAndPushAsBot({
        branch: options.branch,
        message: options.message,
        dir: path.resolve(options.dir),
        botUsername: options.botUsername,
      });
      console.log(renderBotPushResult(result));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

const githubPrCmd = githubCmd.command("pr").description("Pull request actions");

githubPrCmd
  .command("create")
  .description("Create a pull request")
  .requiredOption("--title <text>", "Pull request title")
  .requiredOption("--head <branch>", "Head branch")
  .option("--body <text>", "Pull request body", "")
  .option("--base <branch>", "Base branch")
  .option("--owner <owner>", "GitHub owner/org")
  .option("--repo <repo>", "GitHub repository")
  .action(async (options) => {
    try {
      const config = loadConfig();
      const { createGithubPullRequest } = await import("./github/write-flow.js");
      const { renderPullRequestResult } = await import("./github/cli.js");
      const result = await createGithubPullRequest(config, {
        owner: options.owner,
        repo: options.repo,
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
      });
      console.log(renderPullRequestResult(result));
    } catch (err) {
      console.log(errorLine(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
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
