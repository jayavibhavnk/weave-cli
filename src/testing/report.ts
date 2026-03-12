import { icons, t } from "../ui/theme.js";
import type { TestingRunReport } from "./types.js";

function ms(msValue: number): string {
  if (msValue < 1000) return `${msValue}ms`;
  return `${(msValue / 1000).toFixed(1)}s`;
}

export function renderTestingReport(report: TestingRunReport): string {
  const total = report.results.length;
  const passed = report.results.filter((r) => r.passed).length;
  const failed = total - passed;

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${t.brandBold("Testing Run Report")}`);
  lines.push(`  ${t.muted("─".repeat(60))}`);
  lines.push(`  ${t.label("Project")}       ${report.projectPath}`);
  lines.push(`  ${t.label("Runtime")}       ${report.plan.runtime}`);
  lines.push(`  ${t.label("Commands")}      ${total} (${passed} passed, ${failed} failed)`);
  lines.push(`  ${t.label("Quality score")} ${t.bold(String(report.insights.qualityScore))}/100`);
  lines.push(`  ${t.muted("─".repeat(60))}`);

  for (const result of report.results) {
    const mark = result.passed ? t.success(icons.check) : t.error(icons.cross);
    const color = result.passed ? t.success : t.error;
    lines.push(
      `  ${mark} ${color(result.command.label)} ${t.dim(`(${result.command.command})`)} ${t.muted(ms(result.durationMs))}`
    );
    if (result.command.source === "autonomous" && result.command.rationale) {
      lines.push(`     ${t.dim(`auto rationale: ${result.command.rationale}`)}`);
    }
    const headline = result.output.split("\n")[0]?.trim();
    if (headline) lines.push(`     ${t.dim(headline.substring(0, 120))}`);
  }

  lines.push(`  ${t.muted("─".repeat(60))}`);
  lines.push(`  ${t.label("Summary")} ${report.insights.summary}`);

  if (report.insights.edgeCases.length > 0) {
    lines.push(`  ${t.label("Edge cases")}`);
    for (const item of report.insights.edgeCases.slice(0, 6)) {
      lines.push(`    ${icons.arrowRight} ${item}`);
    }
  }

  if (report.insights.gaps.length > 0) {
    lines.push(`  ${t.label("Coverage gaps")}`);
    for (const item of report.insights.gaps.slice(0, 6)) {
      lines.push(`    ${icons.arrowRight} ${item}`);
    }
  }

  if (report.insights.nextSteps.length > 0) {
    lines.push(`  ${t.label("Recommended next steps")}`);
    for (const item of report.insights.nextSteps.slice(0, 6)) {
      lines.push(`    ${icons.arrowRight} ${item}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
