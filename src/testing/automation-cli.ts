import type { LLMProviderName } from "../core/types.js";
import { icons, table, t } from "../ui/theme.js";
import { computeNextRunAt, parseIntervalMs, parseReminderTime } from "./automation-store.js";
import type {
  AutomationRecord,
  AutomationTarget,
  AutomationTargetType,
  AutomationTrigger,
} from "./automation-types.js";

function formatTime(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "once") {
    return `once @ ${formatTime(trigger.runAt)}`;
  }
  if (trigger.type === "interval") {
    return `every ${Math.round((trigger.intervalMs || 0) / 60000)}m`;
  }
  return `cron ${trigger.cron}`;
}

export function renderAutomationTable(records: AutomationRecord[]): string {
  const rows = records.map((record) => [
    record.id,
    record.enabled ? "enabled" : "paused",
    formatTrigger(record.trigger),
    record.target.type,
    formatTime(record.nextRunAt),
    record.lastStatus || "-",
  ]);
  return table(["ID", "Status", "Schedule", "Target", "Next Run", "Last"], rows);
}

export function renderAutomationCreated(record: AutomationRecord): string {
  return [
    "",
    `  ${t.brandBold("Automation Created")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("ID")}        ${record.id}`,
    `  ${t.label("Name")}      ${record.name}`,
    `  ${t.label("Schedule")}  ${formatTrigger(record.trigger)}`,
    `  ${t.label("Target")}    ${record.target.type}`,
    `  ${t.label("Next run")}  ${formatTime(record.nextRunAt)}`,
    "",
  ].join("\n");
}

export function buildAutomationTrigger(input: {
  every?: string;
  cron?: string;
  at?: string;
}): AutomationTrigger {
  if (input.every) {
    const intervalMs = parseIntervalMs(input.every);
    if (intervalMs === null) {
      throw new Error("Invalid interval. Use forms like 15m, 2h, or 1d.");
    }
    return { type: "interval", intervalMs };
  }
  if (input.cron) {
    const next = computeNextRunAt({ type: "cron", cron: input.cron });
    if (!next) {
      throw new Error("Invalid cron expression. Use 5-field cron syntax.");
    }
    return { type: "cron", cron: input.cron };
  }
  if (input.at) {
    const runAt = parseReminderTime(input.at);
    if (!runAt) {
      throw new Error("Invalid reminder time. Use ISO time, `15m`, or `in 45 minutes`.");
    }
    return { type: "once", runAt };
  }
  throw new Error("Provide one of --every, --cron, or --at.");
}

export function buildAutomationTarget(input: {
  target?: string;
  dir: string;
  workspace?: string;
  timeout?: string;
  maxAuto?: string;
  autonomous?: boolean;
  provider?: string;
  model?: string;
}): AutomationTarget {
  const targetType = (input.target || "testRun") as AutomationTargetType;
  if (targetType !== "testRun" && targetType !== "testPlan") {
    throw new Error("Target must be one of: testRun, testPlan");
  }
  return {
    type: targetType,
    dir: input.dir,
    workspace: input.workspace || "default",
    timeoutMs: Math.max(1000, parseInt(input.timeout || "120000", 10) || 120000),
    maxAuto: Math.max(0, parseInt(input.maxAuto || "0", 10) || 0),
    autonomous: Boolean(input.autonomous),
    provider: input.provider as LLMProviderName | undefined,
    model: input.model,
  };
}

export function renderSchedulerHeartbeat(workspace: string, pollMs: number): string {
  return `  ${t.success(icons.check)} Automation daemon watching ${t.accent(workspace)} every ${pollMs}ms`;
}
