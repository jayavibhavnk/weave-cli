import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { WeaveConfig } from "../core/types.js";
import { loadGithubAppConfig, loadGithubTokenConfig, createGithubAppJwt } from "./app-auth.js";
import { getGithubApiBaseUrl } from "../config.js";
import { createGithubClient, filesToTreeEntries, worktreeChangesToTreeEntries } from "./client.js";
import type {
  GithubAppConfig,
  GithubFileInput,
  GithubPullRequestResult,
  GithubTokenConfig,
  GithubWorktreeChange,
} from "./types.js";

export interface GithubRepoSelection {
  owner: string;
  repo: string;
}

export interface GithubBranchResult {
  owner: string;
  repo: string;
  branch: string;
  sha: string;
}

export interface GithubCommitFlowResult {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  changedFiles: string[];
}

export function parseGitStatusPorcelain(output: string, dir: string): GithubWorktreeChange[] {
  const changes: GithubWorktreeChange[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const status = line.slice(0, 2);
    const remainder = line.slice(3);
    const normalized = remainder.includes(" -> ")
      ? remainder.split(" -> ").map((part) => part.trim())
      : [remainder.trim()];

    const first = status[0];
    const second = status[1];
    const effective = first !== " " ? first : second;

    if (effective === "R" && normalized.length === 2) {
      changes.push({ repoPath: normalized[0].replace(/\\/g, "/"), kind: "delete" });
      const newPath = path.resolve(dir, normalized[1]);
      changes.push({
        repoPath: normalized[1].replace(/\\/g, "/"),
        kind: "upsert",
        content: fs.readFileSync(newPath, "utf-8"),
      });
      continue;
    }

    const repoPath = normalized[normalized.length - 1].replace(/\\/g, "/");
    if (effective === "D") {
      changes.push({ repoPath, kind: "delete" });
      continue;
    }

    const fullPath = path.resolve(dir, repoPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
    changes.push({
      repoPath,
      kind: "upsert",
      content: fs.readFileSync(fullPath, "utf-8"),
    });
  }

  return changes;
}

function detectLocalGitChanges(dir: string): GithubWorktreeChange[] {
  let output = "";
  try {
    output = execSync("git status --porcelain=v1 --untracked-files=all", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    throw new Error(
      `Unable to read local git worktree. ${e.stderr?.trim() || "Make sure the directory is a git repo."}`
    );
  }

  return parseGitStatusPorcelain(output, dir);
}

function requireAppConfig(config: WeaveConfig): GithubAppConfig {
  const appConfig = loadGithubAppConfig(config);
  if (!appConfig) {
    throw new Error(
      "GitHub App is not configured. Set githubAppId and githubAppPrivateKeyPath (or githubAppPrivateKey)."
    );
  }
  return appConfig;
}

function requireTokenConfig(config: WeaveConfig): GithubTokenConfig {
  const tokenConfig = loadGithubTokenConfig(config);
  if (!tokenConfig) {
    throw new Error(
      "GitHub bot token is not configured. Set WEAVE_TEST_GITHUB_BOT_TOKEN (or GITHUB_TOKEN / GH_TOKEN)."
    );
  }
  return tokenConfig;
}

function getGithubAuthMode(config: WeaveConfig): "app" | "token" {
  const configuredMode = config.githubAuthMode;
  if (configuredMode === "app" || configuredMode === "token") {
    return configuredMode;
  }
  return loadGithubTokenConfig(config) ? "token" : "app";
}

function getConfiguredOwnerRepo(config: WeaveConfig): {
  owner?: string;
  repo?: string;
} {
  const mode = getGithubAuthMode(config);
  if (mode === "token") {
    const tokenConfig = loadGithubTokenConfig(config);
    return {
      owner: tokenConfig?.owner,
      repo: tokenConfig?.repo,
    };
  }
  const appConfig = loadGithubAppConfig(config);
  return {
    owner: appConfig?.owner,
    repo: appConfig?.repo,
  };
}

export function resolveOwnerRepo(
  config: WeaveConfig,
  owner?: string,
  repo?: string
): GithubRepoSelection {
  const defaults = getConfiguredOwnerRepo(config);
  const resolvedOwner = owner || defaults.owner;
  const resolvedRepo = repo || defaults.repo;
  if (!resolvedOwner || !resolvedRepo) {
    throw new Error("Provide --owner and --repo or configure githubOwner/githubRepo.");
  }
  return { owner: resolvedOwner, repo: resolvedRepo };
}

export async function getGithubAccessForRepo(
  config: WeaveConfig,
  owner: string,
  repo: string,
  fetchImpl?: typeof fetch
): Promise<{ token: string; client: ReturnType<typeof createGithubClient>; mode: "app" | "token" }> {
  const mode = getGithubAuthMode(config);
  if (mode === "token") {
    const tokenConfig = requireTokenConfig(config);
    const client = createGithubClient(
      {
        appId: "token",
        privateKey: "",
        apiBaseUrl: tokenConfig.apiBaseUrl,
        owner: tokenConfig.owner,
        repo: tokenConfig.repo,
      },
      fetchImpl
    );
    return { token: tokenConfig.token, client, mode };
  }

  const appConfig = requireAppConfig(config);
  const client = createGithubClient(appConfig, fetchImpl);
  const jwt = createGithubAppJwt(appConfig.appId, appConfig.privateKey);
  const installation = await client.getRepoInstallation(owner, repo, jwt);
  const token = await client.createInstallationToken(installation.id, jwt);
  return { token: token.token, client, mode };
}

export async function getGithubAppStatus(
  config: WeaveConfig,
  fetchImpl?: typeof fetch
): Promise<{
  appSlug: string;
  owner?: string;
  repo?: string;
}> {
  const appConfig = requireAppConfig(config);
  const client = createGithubClient(appConfig, fetchImpl);
  const jwt = createGithubAppJwt(appConfig.appId, appConfig.privateKey);
  const app = await client.getAppWithJwt(jwt);
  return {
    appSlug: app.slug,
    owner: appConfig.owner,
    repo: appConfig.repo,
  };
}

export function getGithubAuthStatus(config: WeaveConfig): {
  mode: "app" | "token";
  owner?: string;
  repo?: string;
  username?: string;
  hasToken: boolean;
  apiBaseUrl: string;
} {
  const mode = getGithubAuthMode(config);
  const tokenConfig = loadGithubTokenConfig(config);
  const defaults = getConfiguredOwnerRepo(config);
  return {
    mode,
    owner: defaults.owner,
    repo: defaults.repo,
    username: tokenConfig?.username,
    hasToken: Boolean(tokenConfig?.token),
    apiBaseUrl: getGithubApiBaseUrl(config),
  };
}

export async function listConnectedRepos(
  config: WeaveConfig,
  owner?: string,
  repo?: string,
  fetchImpl?: typeof fetch
): Promise<{ full_name: string; default_branch?: string }[]> {
  const target = resolveOwnerRepo(config, owner, repo);
  const { token, client, mode } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);
  if (mode === "token") {
    const repoInfo = await client.getRepo(target.owner, target.repo, token);
    return [{ full_name: `${target.owner}/${target.repo}`, default_branch: repoInfo.default_branch }];
  }
  const result = await client.listInstallationRepos(token);
  return result.repositories;
}

export async function getGithubBranchInfo(
  config: WeaveConfig,
  input: {
    owner?: string;
    repo?: string;
    branch: string;
  },
  fetchImpl?: typeof fetch
): Promise<{ owner: string; repo: string; branch: string; sha: string }> {
  const target = resolveOwnerRepo(config, input.owner, input.repo);
  const { token, client } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);
  const branch = await client.getBranch(target.owner, target.repo, input.branch, token);
  return {
    owner: target.owner,
    repo: target.repo,
    branch: input.branch,
    sha: branch.commit.sha,
  };
}

async function getRefIfExists(
  config: WeaveConfig,
  owner: string,
  repo: string,
  ref: string,
  fetchImpl?: typeof fetch
): Promise<{ sha: string } | null> {
  try {
    const { token, client } = await getGithubAccessForRepo(config, owner, repo, fetchImpl);
    const result = await client.getRef(owner, repo, ref, token);
    return { sha: result.object.sha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("GitHub API 404")) return null;
    throw err;
  }
}

async function assertBranchPathIsCreatable(
  config: WeaveConfig,
  owner: string,
  repo: string,
  branch: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const existingBranch = await getRefIfExists(config, owner, repo, `heads/${branch}`, fetchImpl);
  if (existingBranch) {
    throw new Error(`Branch "${branch}" already exists.`);
  }

  const parts = branch.split("/");
  if (parts.length <= 1) return;

  const prefixes: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    prefixes.push(parts.slice(0, i + 1).join("/"));
  }

  for (const prefix of prefixes) {
    const conflicting = await getRefIfExists(config, owner, repo, `heads/${prefix}`, fetchImpl);
    if (conflicting) {
      throw new Error(
        `Cannot create branch "${branch}" because branch "${prefix}" already exists. GitHub cannot create nested branch refs under an existing branch name. Use a different branch name like "${branch.replace(/\//g, "-")}".`
      );
    }
  }
}

export async function createGithubBranch(
  config: WeaveConfig,
  input: {
    owner?: string;
    repo?: string;
    branch: string;
    baseBranch?: string;
  },
  fetchImpl?: typeof fetch
): Promise<GithubBranchResult> {
  const target = resolveOwnerRepo(config, input.owner, input.repo);
  await assertBranchPathIsCreatable(config, target.owner, target.repo, input.branch, fetchImpl);
  const { token, client } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);
  const repoInfo = await client.getRepo(target.owner, target.repo, token);
  const baseBranch = input.baseBranch || repoInfo.default_branch;
  const base = await client.getBranch(target.owner, target.repo, baseBranch, token);
  const created = await client.createRef(
    target.owner,
    target.repo,
    `refs/heads/${input.branch}`,
    base.commit.sha,
    token
  );
  return {
    owner: target.owner,
    repo: target.repo,
    branch: input.branch,
    sha: created.sha,
  };
}

export function loadLocalFilesForCommit(
  dir: string,
  filePaths: string[]
): GithubFileInput[] {
  if (filePaths.length === 0) {
    throw new Error("Provide at least one file path to commit.");
  }
  return filePaths.map((filePath) => {
    const fullPath = path.resolve(dir, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error(`Expected file but found directory: ${filePath}`);
    }
    return {
      repoPath: filePath.replace(/\\/g, "/"),
      content: fs.readFileSync(fullPath, "utf-8"),
    };
  });
}

function summarizeChangedPaths(changes: GithubWorktreeChange[]): string[] {
  return changes.map((change) =>
    change.kind === "delete" ? `${change.repoPath} (deleted)` : change.repoPath
  );
}

export async function createGithubCommitFromFiles(
  config: WeaveConfig,
  input: {
    owner?: string;
    repo?: string;
    branch: string;
    message: string;
    dir: string;
    filePaths: string[];
  },
  fetchImpl?: typeof fetch
): Promise<GithubCommitFlowResult> {
  const target = resolveOwnerRepo(config, input.owner, input.repo);
  const files = loadLocalFilesForCommit(input.dir, input.filePaths);
  const { token, client } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);

  const ref = await client.getRef(target.owner, target.repo, `heads/${input.branch}`, token);
  const parentSha = ref.object.sha;
  const parentCommit = await client.getCommit(target.owner, target.repo, parentSha, token);
  const blobs = await Promise.all(
    files.map((file) => client.createBlob(target.owner, target.repo, file.content, token))
  );
  const tree = await client.createTree(
    target.owner,
    target.repo,
    parentCommit.tree.sha,
    filesToTreeEntries(files, blobs.map((blob) => blob.sha)),
    token
  );
  const commit = await client.createCommit(
    target.owner,
    target.repo,
    input.message,
    tree.sha,
    [parentSha],
    token
  );
  await client.updateRef(target.owner, target.repo, `heads/${input.branch}`, commit.sha, token);

  return {
    owner: target.owner,
    repo: target.repo,
    branch: input.branch,
    commitSha: commit.sha,
    changedFiles: files.map((file) => file.repoPath),
  };
}

export async function pushGithubWorktree(
  config: WeaveConfig,
  input: {
    owner?: string;
    repo?: string;
    branch: string;
    message: string;
    dir: string;
    createBranchIfMissing?: boolean;
    baseBranch?: string;
  },
  fetchImpl?: typeof fetch
): Promise<GithubCommitFlowResult> {
  const target = resolveOwnerRepo(config, input.owner, input.repo);
  const changes = detectLocalGitChanges(input.dir);
  if (changes.length === 0) {
    throw new Error("No local git changes detected.");
  }

  const { token, client } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);

  let branchExists = true;
  try {
    await client.getRef(target.owner, target.repo, `heads/${input.branch}`, token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("GitHub API 404")) throw err;
    branchExists = false;
  }

  if (!branchExists) {
    if (!input.createBranchIfMissing) {
      throw new Error(
        `Branch "${input.branch}" does not exist on GitHub. Create it first or set createBranchIfMissing=true.`
      );
    }
    await createGithubBranch(
      config,
      {
        owner: target.owner,
        repo: target.repo,
        branch: input.branch,
        baseBranch: input.baseBranch,
      },
      fetchImpl
    );
  }

  const ref = await client.getRef(target.owner, target.repo, `heads/${input.branch}`, token);
  const parentSha = ref.object.sha;
  const parentCommit = await client.getCommit(target.owner, target.repo, parentSha, token);
  const upserts = changes.filter((change) => change.kind === "upsert");
  const blobs = await Promise.all(
    upserts.map((change) => client.createBlob(target.owner, target.repo, change.content || "", token))
  );
  const blobShasByPath = new Map<string, string>();
  upserts.forEach((change, index) => blobShasByPath.set(change.repoPath, blobs[index].sha));

  const tree = await client.createTree(
    target.owner,
    target.repo,
    parentCommit.tree.sha,
    worktreeChangesToTreeEntries(changes, blobShasByPath),
    token
  );
  const commit = await client.createCommit(
    target.owner,
    target.repo,
    input.message,
    tree.sha,
    [parentSha],
    token
  );
  await client.updateRef(target.owner, target.repo, `heads/${input.branch}`, commit.sha, token);

  return {
    owner: target.owner,
    repo: target.repo,
    branch: input.branch,
    commitSha: commit.sha,
    changedFiles: summarizeChangedPaths(changes),
  };
}

export interface BotPushResult {
  branch: string;
  username: string;
  email: string;
}

/**
 * Commit as the bot identity and push using the user's own git credentials.
 * This is exactly how Cursor and Claude Code work: the commit author is set
 * to the bot account, but `git push` uses whatever auth the user already has
 * (SSH keys, credential helper, etc). GitHub maps the commit email to the
 * bot's GitHub account, so it shows up as a contributor.
 */
export function gitCommitAndPushAsBot(
  input: {
    branch: string;
    message: string;
    dir: string;
    botUsername?: string;
  }
): BotPushResult {
  const username = input.botUsername || process.env.WEAVE_TEST_GITHUB_BOT_USERNAME || "weave-cli";
  const email = `${username}@users.noreply.github.com`;
  const gitOpts = { cwd: input.dir, encoding: "utf-8" as BufferEncoding };

  execSync(`git add -A`, gitOpts);

  try {
    execSync(
      `git -c user.name="${username}" -c user.email="${email}" commit -m "${input.message.replace(/"/g, '\\"')}"`,
      gitOpts
    );
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout?.includes("nothing to commit") || e.stderr?.includes("nothing to commit")) {
      throw new Error("Nothing to commit -- working tree is clean.");
    }
    throw err;
  }

  execSync(`git push origin HEAD:refs/heads/${input.branch}`, gitOpts);

  return {
    branch: input.branch,
    username,
    email,
  };
}

export async function createGithubPullRequest(
  config: WeaveConfig,
  input: {
    owner?: string;
    repo?: string;
    title: string;
    body?: string;
    head: string;
    base?: string;
  },
  fetchImpl?: typeof fetch
): Promise<GithubPullRequestResult> {
  const target = resolveOwnerRepo(config, input.owner, input.repo);
  const { token, client } = await getGithubAccessForRepo(config, target.owner, target.repo, fetchImpl);
  const repoInfo = await client.getRepo(target.owner, target.repo, token);
  return client.createPullRequest(
    target.owner,
    target.repo,
    input.title,
    input.body || "",
    input.head,
    input.base || repoInfo.default_branch,
    token
  );
}
