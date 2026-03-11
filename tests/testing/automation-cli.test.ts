import { describe, it, expect } from "vitest";
import { buildAutomationTarget, buildAutomationTrigger } from "../../src/testing/automation-cli.js";

describe("automation cli helpers", () => {
  it("builds interval and one-shot triggers", () => {
    const interval = buildAutomationTrigger({ every: "30m" });
    expect(interval.type).toBe("interval");

    const once = buildAutomationTrigger({ at: "in 2 hours" });
    expect(once.type).toBe("once");
    expect(once.runAt).toBeGreaterThan(Date.now());
  });

  it("builds automation targets with defaults", () => {
    const target = buildAutomationTarget({
      dir: ".",
      workspace: "default",
      autonomous: true,
      maxAuto: "2",
      timeout: "5000",
    });
    expect(target.type).toBe("testRun");
    expect(target.maxAuto).toBe(2);
    expect(target.autonomous).toBe(true);
    expect(target.timeoutMs).toBe(5000);
  });
});
