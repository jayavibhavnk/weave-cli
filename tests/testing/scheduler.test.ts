import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AutomationStore } from "../../src/testing/automation-store.js";
import { AutomationScheduler } from "../../src/testing/scheduler.js";

describe("automation scheduler", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-scheduler-home-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes due one-time automations and disables them", async () => {
    const store = await AutomationStore.createForPath(path.join(tmpDir, "test.db"));
    const record = store.create({
      name: "One-time plan",
      trigger: { type: "once", runAt: Date.now() + 60_000 },
      target: {
        type: "testPlan",
        dir: ".",
        workspace: "default",
        timeoutMs: 5_000,
        maxAuto: 0,
        autonomous: false,
      },
      maxFailures: 2,
    });
    record.nextRunAt = Date.now() - 1_000;
    store.save(record);

    const scheduler = new AutomationScheduler(store, {
      pollMs: 10,
      executor: async () => ({ status: "passed", summary: "ok" }),
    });

    const processed = await scheduler.tickOnce();
    const updated = store.get(record.id)!;
    expect(processed).toBe(1);
    expect(updated.enabled).toBe(false);
    expect(updated.lastStatus).toBe("passed");
    expect(store.listRuns(record.id)).toHaveLength(1);
    store.close();
  });

  it("auto-pauses recurring automations after repeated failures", async () => {
    const store = await AutomationStore.createForPath(path.join(tmpDir, "test.db"));
    const record = store.create({
      name: "Failing recurring run",
      trigger: { type: "interval", intervalMs: 1_000 },
      target: {
        type: "testRun",
        dir: ".",
        workspace: "default",
        timeoutMs: 5_000,
        maxAuto: 0,
        autonomous: false,
      },
      maxFailures: 1,
    });
    record.nextRunAt = Date.now() - 1_000;
    store.save(record);

    const scheduler = new AutomationScheduler(store, {
      pollMs: 10,
      executor: async () => ({ status: "failed", summary: "boom" }),
    });

    await scheduler.tickOnce();
    const updated = store.get(record.id)!;
    expect(updated.enabled).toBe(false);
    expect(updated.failureCount).toBe(1);
    expect(updated.lastStatus).toBe("failed");
    store.close();
  });
});
