export type TestCommandKind =
  | "lint"
  | "typecheck"
  | "unit"
  | "integration"
  | "e2e"
  | "build"
  | "custom";

export interface TestCommand {
  id: string;
  kind: TestCommandKind;
  label: string;
  command: string;
  required: boolean;
  source?: "discovery" | "autonomous";
  rationale?: string;
}

export interface CommandExecutionResult {
  command: TestCommand;
  startedAt: number;
  endedAt: number;
  exitCode: number;
  output: string;
  passed: boolean;
  durationMs: number;
  passedCount?: number;
  failedCount?: number;
}

export interface TestingPlan {
  runtime: "node" | "python" | "go" | "rust" | "unknown";
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  commands: TestCommand[];
  notes: string[];
}

export interface TestingInsights {
  summary: string;
  qualityScore: number;
  edgeCases: string[];
  gaps: string[];
  nextSteps: string[];
}

export interface TestingRunReport {
  projectPath: string;
  createdAt: number;
  plan: TestingPlan;
  results: CommandExecutionResult[];
  insights: TestingInsights;
}

export interface AutonomousPlanItem {
  label: string;
  command: string;
  rationale: string;
  kind?: TestCommandKind;
}
