import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AutomationStore,
  computeNextRunAt,
  parseIntervalMs,
  parseReminderTime,
} from "../../src/testing/automation-store.js";

describe("automation store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-automation-home-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses intervals and reminder times", () => {
    expect(parseIntervalMs("15m")).toBe(15 * 60_000);
    expect(parseIntervalMs("2h")).toBe(2 * 3_600_000);
    const now = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(parseReminderTime("in 45 minutes", now)).toBe(now + 45 * 60_000);
  });

  it("computes next cron fire time", () => {
    const fromTs = new Date(2026, 0, 1, 10, 15, 0, 0).getTime();
    const next = computeNextRunAt({ type: "cron", cron: "30 10 * * *" }, fromTs);
    const date = new Date(next!);
    expect(date.getHours()).toBe(10);
    expect(date.getMinutes()).toBe(30);
  });

  it("creates, saves, and loads automations", async () => {
    const store = await AutomationStore.createForPath(path.join(tmpDir, "test.db"));
    const record = store.create({
      name: "Morning smoke test",
      trigger: { type: "interval", intervalMs: 60_000 },
      target: {
        type: "testRun",
        dir: ".",
        workspace: "default",
        timeoutMs: 10_000,
        maxAuto: 0,
        autonomous: false,
      },
    });

    const loaded = store.get(record.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Morning smoke test");
    expect(store.list()).toHaveLength(1);
    store.close();
  });
});
