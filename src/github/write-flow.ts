import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { WeaveConfig } from "../core/types.js";
import { loadGithubAppConfig, createGithubAppJwt } from "./app-auth.js";
import { createGithubClient, filesToTreeEntries } from "./client.js";
import type {
  GithubAppConfig,
  GithubFileInput,
  GithubPullRequestResult,
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

export interface BotPushResult {
  branch: string;
  username: string;
  email: string;
}

// ── GitHub App auth helpers (for API-based branch/PR creation) ──

function requireAppConfig(config: WeaveConfig): GithubAppConfig {
  const appConfig = loadGithubAppConfig(config);
  if (!appConfig) {
    throw new Error(
      "GitHub App is not configured. Set githubAppId and githubAppPrivateKeyPath (or githubAppPrivateKey)."
    );
  }
  return appConfig;
}

export function resolveOwnerRepo(
  config: WeaveConfig,
  owner?: string,
  repo?: string
): GithubRepoSelection {
  const appConfig = loadGithubAppConfig(config);
  const resolvedOwner = owner || appConfig?.owner || config.githubOwner;
  const resolvedRepo = repo || appConfig?.repo || config.githubRepo;
  if (!resolvedOwner || !resolvedRepo) {
    throw new Error("Provide --owner and --repo or configure githubOwner/githubRepo.");
  }
  return { owner: resolvedOwner, repo: resolvedRepo };
}

export async function getInstallationTokenForRepo(
  config: WeaveConfig,
  owner: string,
  repo: string,
  fetchImpl?: typeof fetch
): Promise<{ token: string; client: ReturnType<typeof createGithubClient> }> {
  const appConfig = requireAppConfig(config);
  const client = createGithubClient(appConfig, fetchImpl);
  const jwt = createGithubAppJwt(appConfig.appId, appConfig.privateKey);
  const installation = await client.getRepoInstallation(owner, repo, jwt);
  const token = await client.createInstallationToken(installation.id, jwt);
  return { token: token.token, client };
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

export async function listConnectedRepos(
  config: WeaveConfig,
  owner?: string,
  repo?: string,
  fetchImpl?: typeof fetch
): Promise<{ full_name: string; default_branch?: string }[]> {
  const target = resolveOwnerRepo(config, owner, repo);
  const { token, client } = await getInstallationTokenForRepo(config, target.owner, target.repo, fetchImpl);
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
  const { token, client } = await getInstallationTokenForRepo(config, target.owner, target.repo, fetchImpl);
  const branch = await client.getBranch(target.owner, target.repo, input.branch, token);
  return {
    owner: target.owner,
    repo: target.repo,
    branch: input.branch,
    sha: branch.commit.sha,
  };
}

// ── Branch creation (via GitHub App API) ──

async function getRefIfExists(
  config: WeaveConfig,
  owner: string,
  repo: string,
  ref: string,
  fetchImpl?: typeof fetch
): Promise<{ sha: string } | null> {
  try {
    const { token, client } = await getInstallationTokenForRepo(config, owner, repo, fetchImpl);
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
  const { token, client } = await getInstallationTokenForRepo(config, target.owner, target.repo, fetchImpl);
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

// ── File commit via GitHub App API ──

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
  const { token, client } = await getInstallationTokenForRepo(config, target.owner, target.repo, fetchImpl);

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

// ── Bot push (the simple way -- like Cursor / Claude Code) ──

/**
 * Commit as the bot identity and push using the user's existing git credentials.
 * GitHub maps the commit email to the bot's GitHub account, so it shows up
 * as a contributor. No bot PAT or GitHub API needed.
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

// ── PR creation (via GitHub App API) ──

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
  const { token, client } = await getInstallationTokenForRepo(config, target.owner, target.repo, fetchImpl);
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
