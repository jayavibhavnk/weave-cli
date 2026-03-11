import type { AgentMemory } from "../core/agent.js";
import { MemoryType } from "../core/types.js";
import type { LLMProvider } from "../llm/provider.js";
import type {
  CommandExecutionResult,
  TestingInsights,
  TestingPlan,
  TestingRunReport,
} from "./types.js";

function fallbackInsights(results: CommandExecutionResult[]): TestingInsights {
  const failures = results.filter((r) => !r.passed);
  const summary =
    failures.length === 0
      ? "All executed checks passed. Continue expanding edge-case and integration coverage."
      : `${failures.length} check(s) failed. Prioritize fixing failing checks before new feature work.`;

  const score = Math.max(0, 100 - failures.length * 25);
  return {
    summary,
    qualityScore: score,
    edgeCases: [
      "Invalid or empty user input paths and identifiers",
      "Concurrent writes/race conditions under repeated requests",
      "Boundary limits (very large payloads and deeply nested objects)",
    ],
    gaps: failures.length > 0 ? failures.map((f) => `${f.command.label} is failing`) : [],
    nextSteps: [
      "Add regression tests for every failure fixed in this run",
      "Add property-based tests for parser/validation logic",
      "Run smoke tests against production-like environment variables",
    ],
  };
}

function safeJsonParse(text: string): Partial<TestingInsights> | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1)) as Partial<TestingInsights>;
  } catch {
    return null;
  }
}

export async function buildTestingInsights(
  provider: LLMProvider | null,
  model: string,
  plan: TestingPlan,
  results: CommandExecutionResult[]
): Promise<TestingInsights> {
  if (!provider) return fallbackInsights(results);

  const failures = results
    .filter((r) => !r.passed)
    .map((r) => ({
      command: r.command.command,
      label: r.command.label,
      output: r.output.slice(0, 2000),
    }));

  const prompt = [
    "You are a senior test orchestrator agent.",
    "Given the test execution data, return strict JSON with this shape:",
    '{ "summary": string, "qualityScore": number, "edgeCases": string[], "gaps": string[], "nextSteps": string[] }',
    "qualityScore must be between 0 and 100.",
    "",
    `Runtime: ${plan.runtime}; package manager: ${plan.packageManager}`,
    `Executed commands: ${results.length}`,
    `Passed: ${results.filter((r) => r.passed).length}`,
    `Failed: ${failures.length}`,
    "",
    `Failures JSON: ${JSON.stringify(failures)}`,
  ].join("\n");

  try {
    const response = await provider.chat(
      [
        { role: "system", content: "Return JSON only. No markdown." },
        { role: "user", content: prompt },
      ],
      model
    );
    const parsed = safeJsonParse(response);
    if (!parsed) return fallbackInsights(results);
    return {
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary
          : fallbackInsights(results).summary,
      qualityScore:
        typeof parsed.qualityScore === "number"
          ? Math.min(100, Math.max(0, Math.round(parsed.qualityScore)))
          : fallbackInsights(results).qualityScore,
      edgeCases: Array.isArray(parsed.edgeCases)
        ? parsed.edgeCases.filter((x): x is string => typeof x === "string")
        : fallbackInsights(results).edgeCases,
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.filter((x): x is string => typeof x === "string")
        : fallbackInsights(results).gaps,
      nextSteps: Array.isArray(parsed.nextSteps)
        ? parsed.nextSteps.filter((x): x is string => typeof x === "string")
        : fallbackInsights(results).nextSteps,
    };
  } catch {
    return fallbackInsights(results);
  }
}

export function makeTestingReport(
  projectPath: string,
  plan: TestingPlan,
  results: CommandExecutionResult[],
  insights: TestingInsights
): TestingRunReport {
  return {
    projectPath,
    createdAt: Date.now(),
    plan,
    results,
    insights,
  };
}

export async function persistRunToMemory(
  orchestrator: AgentMemory,
  edgeHunter: AgentMemory,
  reporter: AgentMemory,
  report: TestingRunReport
): Promise<void> {
  const resultSummary = report.results
    .map((r) => `${r.command.kind}:${r.passed ? "pass" : "fail"}:${r.command.command}`)
    .join(" | ");

  await orchestrator.add(
    `Testing run summary (${new Date(report.createdAt).toISOString()}): ${resultSummary}`,
    {
      importance: 0.75,
      type: MemoryType.EPISODIC,
      metadata: { qualityScore: report.insights.qualityScore },
    }
  );

  for (const edgeCase of report.insights.edgeCases.slice(0, 10)) {
    await edgeHunter.add(`Edge case to test: ${edgeCase}`, {
      importance: 0.7,
      type: MemoryType.PROCEDURAL,
    });
  }

  await reporter.add(
    `Quality score=${report.insights.qualityScore}. Summary: ${report.insights.summary}`,
    {
      importance: 0.8,
      type: MemoryType.SEMANTIC,
      metadata: {
        failedCommands: report.results.filter((r) => !r.passed).map((r) => r.command.command),
      },
    }
  );
}
