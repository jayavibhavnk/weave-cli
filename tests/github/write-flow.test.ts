import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getDefaultConfig } from "../../src/config.js";
import {
  createGithubBranch,
  createGithubCommitFromFiles,
  createGithubPullRequest,
  getGithubBranchInfo,
  listConnectedRepos,
  parseGitStatusPorcelain,
  pushGithubWorktree,
} from "../../src/github/write-flow.js";

function makeConfig() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    ...getDefaultConfig(),
    githubAppId: "123",
    githubAppPrivateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    githubOwner: "acme",
    githubRepo: "repo",
  };
}

function responseJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("github write flow", () => {
  it("lists connected repos", async () => {
    const queue = [
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ repositories: [{ full_name: "acme/repo", default_branch: "main" }] }),
    ];
    const calls: string[] = [];
    const repos = await listConnectedRepos(
      makeConfig(),
      "acme",
      "repo",
      async (input) => {
        calls.push(String(input));
        return queue.shift()!;
      }
    );
    expect(repos[0].full_name).toBe("acme/repo");
    expect(calls[0]).toContain("/repos/acme/repo/installation");
    expect(calls[2]).toContain("/installation/repositories");
  });

  it("gets branch info", async () => {
    const queue = [
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ commit: { sha: "abc123" } }),
    ];
    const result = await getGithubBranchInfo(makeConfig(), { branch: "main" }, async () => queue.shift()!);
    expect(result.sha).toBe("abc123");
  });

  it("creates branch, commit, and pull request through GitHub API", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-gh-write-"));
    fs.writeFileSync(path.join(dir, "src.txt"), "hello github", "utf-8");
    const fetchCalls: Array<{ url: string; body?: string }> = [];
    const queue = [
      responseJson({ message: "Not Found" }, 404),
      responseJson({ message: "Not Found" }, 404),
      // branch create
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ default_branch: "main" }),
      responseJson({ commit: { sha: "base-sha" } }),
      responseJson({ ref: "refs/heads/weave-test/demo", sha: "base-sha" }),
      // commit flow
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ object: { sha: "parent-sha" } }),
      responseJson({ sha: "parent-sha", tree: { sha: "tree-base" } }),
      responseJson({ sha: "blob-sha" }),
      responseJson({ sha: "tree-new" }),
      responseJson({ sha: "commit-new" }),
      responseJson({ ref: "refs/heads/weave-test/demo", sha: "commit-new" }),
      // pr create
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ default_branch: "main" }),
      responseJson({ number: 12, html_url: "https://github.com/acme/repo/pull/12" }),
    ];

    const fetchImpl: typeof fetch = async (input, init) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return queue.shift()!;
    };

    const config = makeConfig();

    const branch = await createGithubBranch(
      config,
      { branch: "weave-test/demo" },
      fetchImpl
    );
    expect(branch.branch).toBe("weave-test/demo");

    const commit = await createGithubCommitFromFiles(
      config,
      {
        branch: "weave-test/demo",
        message: "Add src.txt",
        dir,
        filePaths: ["src.txt"],
      },
      fetchImpl
    );
    expect(commit.commitSha).toBe("commit-new");
    expect(commit.changedFiles).toEqual(["src.txt"]);

    const pr = await createGithubPullRequest(
      config,
      {
        title: "Test PR",
        head: "weave-test/demo",
      },
      fetchImpl
    );
    expect(pr.number).toBe(12);

    expect(fetchCalls.some((call) => call.url.includes("/git/refs"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/git/blobs"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/git/trees"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/git/commits"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/pulls"))).toBe(true);
  });

  it("rejects nested branch names when the prefix branch already exists", async () => {
    const queue = [
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ message: "Not Found" }, 404),
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ object: { sha: "prefix-sha" } }),
    ];

    await expect(
      createGithubBranch(
        makeConfig(),
        { branch: "weave-test/demo" },
        async () => queue.shift()!
      )
    ).rejects.toThrow(/because branch "weave-test" already exists/i);
  });

  it("pushes git worktree changes and can create a missing branch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-gh-worktree-"));
    const repoDir = path.join(dir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const git = await import("node:child_process");
    git.execSync("git init", { cwd: repoDir, stdio: "ignore" });
    git.execSync("git config user.email test@example.com", { cwd: repoDir, stdio: "ignore" });
    git.execSync("git config user.name test", { cwd: repoDir, stdio: "ignore" });
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "original", "utf-8");
    fs.writeFileSync(path.join(repoDir, "removed.txt"), "bye", "utf-8");
    git.execSync("git add . && git commit -m init", { cwd: repoDir, stdio: "ignore" });
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "updated", "utf-8");
    fs.writeFileSync(path.join(dir, "added.txt"), "new", "utf-8");
    fs.copyFileSync(path.join(dir, "added.txt"), path.join(repoDir, "added.txt"));
    fs.rmSync(path.join(repoDir, "removed.txt"));

    const queue = [
      // initial branch existence check => missing
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ message: "Not Found" }, 404),
      // prefix branch check => missing
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ message: "Not Found" }, 404),
      // create branch
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ default_branch: "main" }),
      responseJson({ commit: { sha: "base-sha" } }),
      responseJson({ ref: "refs/heads/bot-demo", sha: "base-sha" }),
      // fetch ref after branch creation
      responseJson({ object: { sha: "parent-sha" } }),
      responseJson({ sha: "parent-sha", tree: { sha: "tree-base" } }),
      responseJson({ sha: "blob-1" }),
      responseJson({ sha: "blob-2" }),
      responseJson({ sha: "tree-next" }),
      responseJson({ sha: "commit-next" }),
      responseJson({ ref: "refs/heads/bot-demo", sha: "commit-next" }),
    ];

    const result = await pushGithubWorktree(
      makeConfig(),
      {
        branch: "bot-demo",
        message: "Push worktree",
        dir: repoDir,
        createBranchIfMissing: true,
      },
      async () => queue.shift()!
    );
    expect(result.commitSha).toBe("commit-next");
    expect(result.changedFiles).toContain("tracked.txt");
    expect(result.changedFiles).toContain("added.txt");
    expect(result.changedFiles).toContain("removed.txt (deleted)");
  });

  it("uses bot token mode without GitHub App installation exchange", async () => {
    const originalToken = process.env.WEAVE_TEST_GITHUB_BOT_TOKEN;
    process.env.WEAVE_TEST_GITHUB_BOT_TOKEN = "bot-token";

    try {
      const calls: string[] = [];
      const queue = [
        responseJson({ message: "Not Found" }, 404),
        responseJson({ default_branch: "main" }),
        responseJson({ commit: { sha: "base-sha" } }),
        responseJson({ ref: "refs/heads/weave-test", sha: "base-sha" }),
      ];

      const result = await createGithubBranch(
        {
          ...makeConfig(),
          githubAuthMode: "token",
        },
        { branch: "weave-test" },
        async (input) => {
          calls.push(String(input));
          return queue.shift()!;
        }
      );

      expect(result.sha).toBe("base-sha");
      expect(calls.some((url) => url.includes("/installation"))).toBe(false);
      expect(calls.some((url) => url.includes("/git/refs"))).toBe(true);
    } finally {
      if (originalToken === undefined) delete process.env.WEAVE_TEST_GITHUB_BOT_TOKEN;
      else process.env.WEAVE_TEST_GITHUB_BOT_TOKEN = originalToken;
    }
  });

  it("parses git porcelain output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-gh-parse-"));
    fs.writeFileSync(path.join(dir, "tracked.txt"), "updated", "utf-8");
    fs.writeFileSync(path.join(dir, "added.txt"), "new", "utf-8");
    const changes = parseGitStatusPorcelain(" M tracked.txt\n?? added.txt\n D removed.txt\n", dir);
    expect(changes).toEqual([
      { repoPath: "tracked.txt", kind: "upsert", content: "updated" },
      { repoPath: "added.txt", kind: "upsert", content: "new" },
      { repoPath: "removed.txt", kind: "delete" },
    ]);
  });
});
