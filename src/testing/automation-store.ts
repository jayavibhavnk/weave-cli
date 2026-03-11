import { getWorkspacePath } from "../config.js";
import { generateId } from "../core/types.js";
import { Storage } from "../core/storage.js";
import type {
  AutomationRecord,
  AutomationRunRecord,
  AutomationTarget,
  AutomationTrigger,
  AutomationRunStatus,
} from "./automation-types.js";

export function parseIntervalMs(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

export function parseReminderTime(input: string, now = Date.now()): number | null {
  const trimmed = input.trim();
  const intervalMatch = trimmed.match(/^in\s+(\d+)\s*(seconds?|minutes?|hours?|days?)$/i);
  if (intervalMatch) {
    const value = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    const map: Record<string, number> = {
      second: 1000,
      seconds: 1000,
      minute: 60_000,
      minutes: 60_000,
      hour: 3_600_000,
      hours: 3_600_000,
      day: 86_400_000,
      days: 86_400_000,
    };
    return now + value * map[unit];
  }

  const short = parseIntervalMs(trimmed);
  if (short !== null) return now + short;

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === "*") {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (!Number.isFinite(step) || step <= 0) return null;
    const values: number[] = [];
    for (let i = min; i <= max; i += step) values.push(i);
    return values;
  }
  if (field.includes(",")) {
    const combined = field.split(",").flatMap((part) => parseCronField(part, min, max) ?? []);
    return combined.length > 0 ? Array.from(new Set(combined)).sort((a, b) => a - b) : null;
  }
  if (field.includes("-")) {
    const [startText, endText] = field.split("-");
    const start = parseInt(startText, 10);
    const end = parseInt(endText, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
    const values: number[] = [];
    for (let i = start; i <= end; i++) values.push(i);
    return values.every((v) => v >= min && v <= max) ? values : null;
  }
  const single = parseInt(field, 10);
  if (!Number.isFinite(single) || single < min || single > max) return null;
  return [single];
}

export function computeNextRunAt(trigger: AutomationTrigger, fromTs = Date.now()): number | undefined {
  if (trigger.type === "once") {
    return trigger.runAt && trigger.runAt > fromTs ? trigger.runAt : undefined;
  }

  if (trigger.type === "interval") {
    if (!trigger.intervalMs || trigger.intervalMs <= 0) return undefined;
    return fromTs + trigger.intervalMs;
  }

  if (trigger.type === "cron") {
    if (!trigger.cron) return undefined;
    const parts = trigger.cron.trim().split(/\s+/);
    if (parts.length !== 5) return undefined;
    const [minuteField, hourField, dayField, monthField, weekField] = parts;
    const minutes = parseCronField(minuteField, 0, 59);
    const hours = parseCronField(hourField, 0, 23);
    const days = parseCronField(dayField, 1, 31);
    const months = parseCronField(monthField, 1, 12);
    const weekdays = parseCronField(weekField, 0, 7);
    if (!minutes || !hours || !days || !months || !weekdays) return undefined;

    const candidate = new Date(fromTs);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    for (let i = 0; i < 525_600; i++) {
      const month = candidate.getMonth() + 1;
      const day = candidate.getDate();
      const hour = candidate.getHours();
      const minute = candidate.getMinutes();
      const weekday = candidate.getDay();
      const weekdayMatch = weekdays.includes(weekday) || (weekday === 0 && weekdays.includes(7));
      if (
        months.includes(month) &&
        (days.includes(day) || weekdayMatch) &&
        hours.includes(hour) &&
        minutes.includes(minute)
      ) {
        return candidate.getTime();
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
  }

  return undefined;
}

export class AutomationStore {
  private constructor(private readonly storage: Storage) {}

  static async create(workspace = "default"): Promise<AutomationStore> {
    const storage = await Storage.create(getWorkspacePath(workspace));
    return new AutomationStore(storage);
  }

  static async createForPath(dbPath: string): Promise<AutomationStore> {
    const storage = await Storage.create(dbPath);
    return new AutomationStore(storage);
  }

  list(): AutomationRecord[] {
    return this.storage.loadAutomations();
  }

  get(id: string): AutomationRecord | null {
    return this.storage.loadAutomation(id);
  }

  create(input: {
    name: string;
    trigger: AutomationTrigger;
    target: AutomationTarget;
    maxFailures?: number;
  }): AutomationRecord {
    const now = Date.now();
    const record: AutomationRecord = {
      id: generateId(),
      name: input.name,
      enabled: true,
      trigger: input.trigger,
      target: input.target,
      createdAt: now,
      updatedAt: now,
      nextRunAt: computeNextRunAt(input.trigger, now - 1000),
      failureCount: 0,
      maxFailures: input.maxFailures ?? 3,
    };
    this.storage.saveAutomation(record);
    return record;
  }

  save(record: AutomationRecord): void {
    this.storage.saveAutomation({ ...record, updatedAt: Date.now() });
  }

  delete(id: string): void {
    this.storage.deleteAutomation(id);
  }

  setEnabled(id: string, enabled: boolean): AutomationRecord | null {
    const record = this.get(id);
    if (!record) return null;
    const updated: AutomationRecord = {
      ...record,
      enabled,
      updatedAt: Date.now(),
      nextRunAt: enabled ? record.nextRunAt ?? computeNextRunAt(record.trigger) : record.nextRunAt,
    };
    this.storage.saveAutomation(updated);
    return updated;
  }

  appendRun(run: AutomationRunRecord): void {
    this.storage.saveAutomationRun(run);
  }

  listRuns(automationId?: string): AutomationRunRecord[] {
    return this.storage.loadAutomationRuns(automationId);
  }

  completeRun(
    record: AutomationRecord,
    runId: string,
    startedAt: number,
    status: AutomationRunStatus,
    summary: string,
    completedAt = Date.now()
  ): AutomationRecord {
    this.storage.saveAutomationRun({
      id: runId,
      automationId: record.id,
      startedAt,
      endedAt: completedAt,
      status,
      summary,
    });

    const isFailure = status === "failed";
    const nextRunAt =
      record.trigger.type === "once"
        ? undefined
        : computeNextRunAt(record.trigger, completedAt);
    const failureCount = isFailure ? record.failureCount + 1 : 0;
    const enabled = record.trigger.type === "once" ? false : failureCount < record.maxFailures;

    const updated: AutomationRecord = {
      ...record,
      enabled,
      updatedAt: completedAt,
      lastRunAt: completedAt,
      nextRunAt,
      failureCount,
      lastStatus: status,
      lastSummary: summary,
    };
    this.storage.saveAutomation(updated);
    return updated;
  }

  close(): void {
    this.storage.close();
  }
}
