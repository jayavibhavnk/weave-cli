import type { LLMProviderName } from "../core/types.js";

export type AutomationTriggerType = "once" | "interval" | "cron";
export type AutomationTargetType = "testRun" | "testPlan";
export type AutomationRunStatus = "running" | "passed" | "failed" | "skipped";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  intervalMs?: number;
  cron?: string;
  runAt?: number;
  timezone?: string;
}

export interface AutomationTarget {
  type: AutomationTargetType;
  dir: string;
  workspace: string;
  timeoutMs: number;
  maxAuto: number;
  autonomous: boolean;
  provider?: LLMProviderName;
  model?: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  target: AutomationTarget;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  failureCount: number;
  maxFailures: number;
  lastStatus?: AutomationRunStatus;
  lastSummary?: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  startedAt: number;
  endedAt?: number;
  status: AutomationRunStatus;
  summary: string;
}
