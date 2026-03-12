import { describe, it, expect } from "vitest";
import { runTestingCommands } from "../../src/testing/runner.js";

describe("runTestingCommands", () => {
  it("runs commands and records pass/fail", () => {
    const results = runTestingCommands(
      [
        {
          id: "ok",
          kind: "custom",
          label: "ok",
          command: "node -e \"console.log('1 passed')\"",
          required: true,
        },
        {
          id: "bad",
          kind: "custom",
          label: "bad",
          command: "node -e \"process.exit(1)\"",
          required: false,
        },
      ],
      process.cwd(),
      10_000
    );

    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[0].passedCount).toBe(1);
    expect(results[1].passed).toBe(false);
  });

  it("stops on required failure", () => {
    const results = runTestingCommands(
      [
        {
          id: "required-fail",
          kind: "custom",
          label: "required fail",
          command: "node -e \"process.exit(1)\"",
          required: true,
        },
        {
          id: "never",
          kind: "custom",
          label: "never",
          command: "node -e \"console.log('skip')\"",
          required: false,
        },
      ],
      process.cwd(),
      10_000
    );

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });
});
