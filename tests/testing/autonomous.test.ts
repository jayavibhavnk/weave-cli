import { describe, it, expect } from "vitest";
import { toAutonomousCommands } from "../../src/testing/autonomous.js";
import type { TestCommand } from "../../src/testing/types.js";

describe("autonomous planning", () => {
  it("filters duplicates and unsafe commands", () => {
    const existing: TestCommand[] = [
      {
        id: "base-1",
        kind: "unit",
        label: "Unit tests",
        command: "npm run test",
        required: true,
      },
    ];

    const out = toAutonomousCommands(
      [
        {
          label: "dup",
          command: "npm run test",
          rationale: "duplicate",
          kind: "unit",
        },
        {
          label: "safe",
          command: "npm run test -- --coverage",
          rationale: "expand confidence with coverage signal",
          kind: "unit",
        },
        {
          label: "unsafe",
          command: "rm -rf /",
          rationale: "nope",
          kind: "custom",
        },
      ],
      existing
    );

    expect(out).toHaveLength(1);
    expect(out[0].command).toBe("npm run test -- --coverage");
    expect(out[0].source).toBe("autonomous");
  });
});
