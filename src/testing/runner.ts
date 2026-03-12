import { execSync } from "node:child_process";
import type { CommandExecutionResult, TestCommand } from "./types.js";

function parseCounts(output: string): { passedCount?: number; failedCount?: number } {
  const passedMatch = output.match(/(\d+)\s+passed/i);
  const failedMatch = output.match(/(\d+)\s+failed/i);
  return {
    passedCount: passedMatch ? parseInt(passedMatch[1], 10) : undefined,
    failedCount: failedMatch ? parseInt(failedMatch[1], 10) : undefined,
  };
}

function runOne(command: TestCommand, cwd: string, timeoutMs: number): CommandExecutionResult {
  const startedAt = Date.now();
  let output = "";
  let exitCode = 0;

  try {
    const stdout = execSync(command.command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    output = stdout || "(no output)";
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim() || "Command failed";
    exitCode = e.status ?? 1;
  }

  const endedAt = Date.now();
  const durationMs = endedAt - startedAt;
  const counts = parseCounts(output);

  return {
    command,
    startedAt,
    endedAt,
    durationMs,
    exitCode,
    passed: exitCode === 0,
    output: output.length > 10000 ? output.slice(0, 10000) + "\n... (truncated)" : output,
    ...counts,
  };
}

export function runTestingCommands(
  commands: TestCommand[],
  cwd: string,
  timeoutMs = 120000
): CommandExecutionResult[] {
  const results: CommandExecutionResult[] = [];
  for (const command of commands) {
    const result = runOne(command, cwd, timeoutMs);
    results.push(result);
    if (!result.passed && command.required) {
      break;
    }
  }
  return results;
}
