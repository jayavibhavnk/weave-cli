import * as fs from "node:fs";
import * as path from "node:path";
import type { TestCommand, TestingPlan } from "./types.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

function detectPackageManager(cwd: string): TestingPlan["packageManager"] {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "unknown";
}

function scriptCommand(pm: TestingPlan["packageManager"], script: string): string {
  if (pm === "pnpm") return `pnpm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  return `npm run ${script}`;
}

function addScriptIfPresent(
  commands: TestCommand[],
  scripts: Record<string, string>,
  packageManager: TestingPlan["packageManager"],
  kind: TestCommand["kind"],
  candidates: string[],
  label: string,
  required: boolean
): void {
  const script = candidates.find((s) => s in scripts);
  if (!script) return;
  commands.push({
    id: `${kind}-${script}`,
    kind,
    label: `${label} (${script})`,
    command: scriptCommand(packageManager, script),
    required,
    source: "discovery",
  });
}

export function discoverTestingPlan(cwd: string): TestingPlan {
  const packageManager = detectPackageManager(cwd);
  const notes: string[] = [];
  const commands: TestCommand[] = [];
  const packagePath = path.join(cwd, "package.json");

  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as PackageJson;
    const scripts = pkg.scripts || {};
    notes.push("Detected Node.js project via package.json.");

    addScriptIfPresent(commands, scripts, packageManager, "lint", ["lint"], "Lint", false);
    addScriptIfPresent(
      commands,
      scripts,
      packageManager,
      "typecheck",
      ["typecheck", "check-types", "tsc"],
      "Typecheck",
      false
    );
    addScriptIfPresent(
      commands,
      scripts,
      packageManager,
      "unit",
      ["test", "test:unit"],
      "Unit tests",
      true
    );
    addScriptIfPresent(
      commands,
      scripts,
      packageManager,
      "integration",
      ["test:integration", "integration"],
      "Integration tests",
      false
    );
    addScriptIfPresent(
      commands,
      scripts,
      packageManager,
      "e2e",
      ["test:e2e", "e2e"],
      "E2E tests",
      false
    );
    addScriptIfPresent(commands, scripts, packageManager, "build", ["build"], "Build", false);

    return {
      runtime: "node",
      packageManager,
      commands,
      notes,
    };
  }

  if (fs.existsSync(path.join(cwd, "pyproject.toml")) || fs.existsSync(path.join(cwd, "requirements.txt"))) {
    notes.push("Detected Python project.");
    commands.push({
      id: "unit-pytest",
      kind: "unit",
      label: "Unit tests (pytest)",
      command: "python -m pytest -q",
      required: true,
      source: "discovery",
    });
    return { runtime: "python", packageManager: "unknown", commands, notes };
  }

  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    notes.push("Detected Go project.");
    commands.push({
      id: "unit-go-test",
      kind: "unit",
      label: "Unit tests (go test)",
      command: "go test ./...",
      required: true,
      source: "discovery",
    });
    return { runtime: "go", packageManager: "unknown", commands, notes };
  }

  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    notes.push("Detected Rust project.");
    commands.push({
      id: "unit-cargo-test",
      kind: "unit",
      label: "Unit tests (cargo test)",
      command: "cargo test",
      required: true,
      source: "discovery",
    });
    return { runtime: "rust", packageManager: "unknown", commands, notes };
  }

  notes.push("No known project runtime detected.");
  return {
    runtime: "unknown",
    packageManager: "unknown",
    commands: [],
    notes,
  };
}
