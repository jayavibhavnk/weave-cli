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
  gitCommitAndPushAsBot,
  listConnectedRepos,
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
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ default_branch: "main" }),
      responseJson({ commit: { sha: "base-sha" } }),
      responseJson({ ref: "refs/heads/weave-test/demo", sha: "base-sha" }),
      responseJson({ id: 7, account: { login: "acme" } }),
      responseJson({ token: "inst-token", expires_at: "2030-01-01T00:00:00Z" }),
      responseJson({ object: { sha: "parent-sha" } }),
      responseJson({ sha: "parent-sha", tree: { sha: "tree-base" } }),
      responseJson({ sha: "blob-sha" }),
      responseJson({ sha: "tree-new" }),
      responseJson({ sha: "commit-new" }),
      responseJson({ ref: "refs/heads/weave-test/demo", sha: "commit-new" }),
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

  it("commits as bot and pushes using git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-bot-push-"));
    const { execSync } = require("node:child_process");
    execSync("git init && git config user.email test@test.com && git config user.name test", { cwd: dir, stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "file.txt"), "hello", "utf-8");
    execSync("git add . && git commit -m init", { cwd: dir, stdio: "ignore" });

    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-bot-bare-"));
    execSync("git init --bare", { cwd: bareDir, stdio: "ignore" });
    execSync(`git remote add origin ${bareDir}`, { cwd: dir, stdio: "ignore" });
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git push origin ${branch}`, { cwd: dir, stdio: "ignore" });

    fs.writeFileSync(path.join(dir, "file.txt"), "updated", "utf-8");

    const result = gitCommitAndPushAsBot({
      branch,
      message: "bot update",
      dir,
      botUsername: "test-bot",
    });

    expect(result.username).toBe("test-bot");
    expect(result.email).toBe("test-bot@users.noreply.github.com");
    expect(result.branch).toBe(branch);

    const log = execSync("git log -1 --format=%an", { cwd: dir, encoding: "utf-8" }).trim();
    expect(log).toBe("test-bot");
  });
});
