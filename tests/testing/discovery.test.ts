import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverTestingPlan } from "../../src/testing/discovery.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-test-discovery-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("discoverTestingPlan", () => {
  it("discovers node scripts in sensible order", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            scripts: {
              lint: "eslint .",
              typecheck: "tsc --noEmit",
              test: "vitest run",
              "test:e2e": "playwright test",
            },
          },
          null,
          2
        )
      );
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");

      const plan = discoverTestingPlan(dir);
      expect(plan.runtime).toBe("node");
      expect(plan.packageManager).toBe("npm");
      expect(plan.commands.map((c) => c.kind)).toEqual([
        "lint",
        "typecheck",
        "unit",
        "e2e",
      ]);
      expect(plan.commands[2].command).toBe("npm run test");
    });
  });

  it("detects python fallback", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname='x'\n");
      const plan = discoverTestingPlan(dir);
      expect(plan.runtime).toBe("python");
      expect(plan.commands[0].command).toContain("pytest");
    });
  });
});
