import { loadConfig, getWorkspacePath, resolveApiKey } from "../config.js";
import { MemoryFabric } from "../core/fabric.js";
import type { LLMProviderName } from "../core/types.js";
import { createProvider } from "../llm/provider.js";
import { generateAutonomousPlan, persistAutonomousPlan, toAutonomousCommands } from "./autonomous.js";
import { discoverTestingPlan } from "./discovery.js";
import { buildTestingInsights, makeTestingReport, persistRunToMemory } from "./orchestrator.js";
import { renderTestingReport } from "./report.js";
import { runTestingCommands } from "./runner.js";
import type { TestCommand, TestingRunReport } from "./types.js";

export interface TestWorkflowOptions {
  workspace?: string;
  dir: string;
  model?: string;
  provider?: LLMProviderName;
  timeoutMs?: number;
  maxAuto?: number;
  autonomous?: boolean;
}

export interface PlannedTestWorkflow {
  discoveredCommands: TestCommand[];
  autonomousCommands: TestCommand[];
}

export interface ExecutedTestWorkflow {
  report: TestingRunReport;
  renderedReport: string;
  discoveredCommands: TestCommand[];
  autonomousCommands: TestCommand[];
}

async function createWorkflowContext(options: TestWorkflowOptions) {
  const config = loadConfig();
  const providerName = options.provider || config.provider;
  const model = options.model || config.model;
  const workspace = options.workspace || "default";
  const workspacePath = getWorkspacePath(workspace);
  const apiKey = resolveApiKey({ ...config, provider: providerName });
  const isLocal = providerName === "ollama" || providerName === "lmstudio";
  const llm = apiKey || isLocal
    ? createProvider(providerName, apiKey || "ollama", model, config.baseURL)
    : null;

  return {
    config,
    providerName,
    model,
    workspace,
    workspacePath,
    llm,
    fabric: await MemoryFabric.create({
      ...config,
      provider: providerName,
      model,
      apiKey,
      workspacePath,
    }),
  };
}

function getTestingAgents(fabric: MemoryFabric, model: string, providerName: LLMProviderName) {
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

  return { orchestrator, edgeHunter, reporter };
}

export async function planTestWorkflow(options: TestWorkflowOptions): Promise<PlannedTestWorkflow> {
  const ctx = await createWorkflowContext(options);
  try {
    const discoveredCommands = discoverTestingPlan(options.dir).commands;
    if (discoveredCommands.length === 0) {
      throw new Error("No test commands discovered for this project.");
    }
    const maxAuto = Math.max(0, options.maxAuto ?? 0);
    const autonomousItems =
      (options.autonomous ?? true) && maxAuto > 0
        ? await generateAutonomousPlan(ctx.llm, ctx.model, discoverTestingPlan(options.dir), maxAuto)
        : [];
    const autonomousCommands = toAutonomousCommands(autonomousItems, discoveredCommands);
    return { discoveredCommands, autonomousCommands };
  } finally {
    ctx.fabric.close();
  }
}

export async function executeTestWorkflow(options: TestWorkflowOptions): Promise<ExecutedTestWorkflow> {
  const ctx = await createWorkflowContext(options);
  try {
    const plan = discoverTestingPlan(options.dir);
    if (plan.commands.length === 0) {
      throw new Error("No test commands discovered for this project.");
    }

    const { orchestrator, edgeHunter, reporter } = getTestingAgents(
      ctx.fabric,
      ctx.model,
      ctx.providerName
    );

    const maxAuto = Math.max(0, options.maxAuto ?? 0);
    const autonomousItems =
      (options.autonomous ?? true) && maxAuto > 0
        ? await generateAutonomousPlan(ctx.llm, ctx.model, plan, maxAuto)
        : [];
    const autonomousCommands = toAutonomousCommands(autonomousItems, plan.commands);

    if (autonomousItems.length > 0) {
      await persistAutonomousPlan(orchestrator, edgeHunter, autonomousItems);
    }

    const results = runTestingCommands(
      [...plan.commands, ...autonomousCommands],
      options.dir,
      options.timeoutMs ?? 120000
    );

    const insights = await buildTestingInsights(ctx.llm, ctx.model, plan, results);
    const report = makeTestingReport(options.dir, plan, results, insights);
    await persistRunToMemory(orchestrator, edgeHunter, reporter, report);
    ctx.fabric.save();

    return {
      report,
      renderedReport: renderTestingReport(report),
      discoveredCommands: plan.commands,
      autonomousCommands,
    };
  } finally {
    ctx.fabric.close();
  }
}
