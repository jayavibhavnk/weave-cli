import { generateId } from "../core/types.js";
import type { AutomationRecord } from "./automation-types.js";
import { AutomationStore } from "./automation-store.js";
import { executeTestWorkflow, planTestWorkflow } from "./run-workflow.js";

export interface AutomationExecutionResult {
  status: "passed" | "failed" | "skipped";
  summary: string;
}

export async function executeAutomationRecord(
  record: AutomationRecord
): Promise<AutomationExecutionResult> {
  if (!record.enabled) {
    return { status: "skipped", summary: "Automation is paused." };
  }

  try {
    if (record.target.type === "testPlan") {
      const planned = await planTestWorkflow({
        workspace: record.target.workspace,
        dir: record.target.dir,
        timeoutMs: record.target.timeoutMs,
        maxAuto: record.target.maxAuto,
        autonomous: record.target.autonomous,
        provider: record.target.provider,
        model: record.target.model,
      });
      return {
        status: "passed",
        summary: `Plan generated with ${planned.discoveredCommands.length} discovered and ${planned.autonomousCommands.length} autonomous commands.`,
      };
    }

    const executed = await executeTestWorkflow({
      workspace: record.target.workspace,
      dir: record.target.dir,
      timeoutMs: record.target.timeoutMs,
      maxAuto: record.target.maxAuto,
      autonomous: record.target.autonomous,
      provider: record.target.provider,
      model: record.target.model,
    });
    const failed = executed.report.results.filter((r) => !r.passed).length;
    return {
      status: failed === 0 ? "passed" : "failed",
      summary:
        failed === 0
          ? "Automation completed successfully."
          : `Automation completed with ${failed} failing command(s).`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", summary: message };
  }
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: AutomationStore,
    private readonly options: {
      pollMs: number;
      logger?: (message: string) => void;
      executor?: (record: AutomationRecord) => Promise<AutomationExecutionResult>;
    }
  ) {}

  async tickOnce(now = Date.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = this.store
        .list()
        .filter((record) => record.enabled && record.nextRunAt !== undefined && record.nextRunAt <= now)
        .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0));

      for (const record of due) {
        const runId = generateId();
        const startedAt = Date.now();
        this.store.appendRun({
          id: runId,
          automationId: record.id,
          startedAt,
          status: "running",
          summary: "Automation execution started.",
        });

        const executor = this.options.executor || executeAutomationRecord;
        const result = await executor(record);
        this.store.completeRun(record, runId, startedAt, result.status, result.summary, Date.now());
        this.options.logger?.(
          `[automation:${record.id}] ${result.status} ${result.summary}`
        );
      }

      return due.length;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.options.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
