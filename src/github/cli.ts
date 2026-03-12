import { table, t } from "../ui/theme.js";
import type { GithubBranchResult, GithubCommitFlowResult, BotPushResult } from "./write-flow.js";
import type { GithubPullRequestResult } from "./types.js";

export function renderGithubStatus(status: {
  appSlug: string;
  owner?: string;
  repo?: string;
}): string {
  return [
    "",
    `  ${t.brandBold("GitHub App Status")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("App")}    ${status.appSlug}`,
    `  ${t.label("Owner")}  ${status.owner || "-"}`,
    `  ${t.label("Repo")}   ${status.repo || "-"}`,
    "",
  ].join("\n");
}

export function renderGithubRepos(rows: { full_name: string; default_branch?: string }[]): string {
  return table(
    ["Repository", "Default Branch"],
    rows.map((row) => [row.full_name, row.default_branch || "-"])
  );
}

export function renderBranchCreated(result: GithubBranchResult): string {
  return [
    "",
    `  ${t.brandBold("Branch Created")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("Repo")}    ${result.owner}/${result.repo}`,
    `  ${t.label("Branch")}  ${result.branch}`,
    `  ${t.label("SHA")}     ${result.sha}`,
    "",
  ].join("\n");
}

export function renderCommitResult(result: GithubCommitFlowResult): string {
  return [
    "",
    `  ${t.brandBold("Commit Pushed")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("Repo")}    ${result.owner}/${result.repo}`,
    `  ${t.label("Branch")}  ${result.branch}`,
    `  ${t.label("Commit")}  ${result.commitSha}`,
    `  ${t.label("Files")}   ${result.changedFiles.join(", ")}`,
    "",
  ].join("\n");
}

export function renderBotPushResult(result: BotPushResult): string {
  return [
    "",
    `  ${t.brandBold("Pushed as bot")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("Branch")}  ${result.branch}`,
    `  ${t.label("Author")}  ${result.username} <${result.email}>`,
    "",
  ].join("\n");
}

export function renderPullRequestResult(result: GithubPullRequestResult): string {
  return [
    "",
    `  ${t.brandBold("Pull Request Created")}`,
    `  ${t.muted("─".repeat(40))}`,
    `  ${t.label("Number")}  ${String(result.number)}`,
    `  ${t.label("URL")}     ${result.html_url}`,
    "",
  ].join("\n");
}
