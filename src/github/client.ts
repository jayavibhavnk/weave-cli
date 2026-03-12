import type {
  GithubAppConfig,
  GithubBlobResult,
  GithubCommitResult,
  GithubFileInput,
  GithubWorktreeChange,
  GithubInstallation,
  GithubInstallationToken,
  GithubPullRequestResult,
  GithubRepoRef,
  GithubTreeEntryInput,
  GithubTreeResult,
} from "./types.js";

export class GithubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit,
    token: string,
    accept = "application/vnd.github+json"
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  getApp(): Promise<{ slug: string; id: number; name?: string }> {
    throw new Error("Use getAppWithJwt instead");
  }

  getAppWithJwt(jwt: string): Promise<{ slug: string; id: number; name?: string }> {
    return this.request("/app", { method: "GET" }, jwt);
  }

  getRepoInstallation(owner: string, repo: string, jwt: string): Promise<GithubInstallation> {
    return this.request(`/repos/${owner}/${repo}/installation`, { method: "GET" }, jwt);
  }

  createInstallationToken(
    installationId: number,
    jwt: string
  ): Promise<GithubInstallationToken> {
    return this.request(
      `/app/installations/${installationId}/access_tokens`,
      { method: "POST", body: JSON.stringify({ permissions: { contents: "write", pull_requests: "write", metadata: "read" } }) },
      jwt
    );
  }

  listInstallationRepos(token: string): Promise<{ repositories: { full_name: string; default_branch?: string }[] }> {
    return this.request("/installation/repositories", { method: "GET" }, token);
  }

  getRepo(owner: string, repo: string, token: string): Promise<{ default_branch: string; permissions?: Record<string, boolean> }> {
    return this.request(`/repos/${owner}/${repo}`, { method: "GET" }, token);
  }

  getBranch(owner: string, repo: string, branch: string, token: string): Promise<{ commit: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { method: "GET" }, token);
  }

  getRef(owner: string, repo: string, ref: string, token: string): Promise<{ object: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/git/ref/${ref}`, { method: "GET" }, token);
  }

  getCommit(owner: string, repo: string, sha: string, token: string): Promise<{ sha: string; tree: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/git/commits/${sha}`, { method: "GET" }, token);
  }

  createRef(owner: string, repo: string, ref: string, sha: string, token: string): Promise<GithubRepoRef> {
    return this.request(
      `/repos/${owner}/${repo}/git/refs`,
      { method: "POST", body: JSON.stringify({ ref, sha }) },
      token
    );
  }

  createBlob(owner: string, repo: string, content: string, token: string): Promise<GithubBlobResult> {
    return this.request(
      `/repos/${owner}/${repo}/git/blobs`,
      { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) },
      token
    );
  }

  createTree(
    owner: string,
    repo: string,
    baseTree: string,
    tree: GithubTreeEntryInput[],
    token: string
  ): Promise<GithubTreeResult> {
    return this.request(
      `/repos/${owner}/${repo}/git/trees`,
      { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) },
      token
    );
  }

  createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[],
    token: string
  ): Promise<GithubCommitResult> {
    return this.request(
      `/repos/${owner}/${repo}/git/commits`,
      { method: "POST", body: JSON.stringify({ message, tree, parents }) },
      token
    );
  }

  updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
    token: string
  ): Promise<GithubRepoRef> {
    return this.request(
      `/repos/${owner}/${repo}/git/refs/${ref}`,
      { method: "PATCH", body: JSON.stringify({ sha, force: false }) },
      token
    );
  }

  createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    token: string
  ): Promise<GithubPullRequestResult> {
    return this.request(
      `/repos/${owner}/${repo}/pulls`,
      { method: "POST", body: JSON.stringify({ title, body, head, base }) },
      token
    );
  }
}

export function filesToTreeEntries(
  files: GithubFileInput[],
  blobShas: string[]
): GithubTreeEntryInput[] {
  return files.map((file, index) => ({
    path: file.repoPath,
    mode: "100644",
    type: "blob",
    sha: blobShas[index],
  }));
}

export function createGithubClient(config: GithubAppConfig, fetchImpl?: typeof fetch): GithubClient {
  return new GithubClient(config.apiBaseUrl.replace(/\/$/, ""), fetchImpl);
}

export function worktreeChangesToTreeEntries(
  changes: GithubWorktreeChange[],
  blobShasByPath: Map<string, string>
): GithubTreeEntryInput[] {
  return changes.map((change) => ({
    path: change.repoPath,
    mode: "100644",
    type: "blob",
    sha: change.kind === "delete" ? null : blobShasByPath.get(change.repoPath) || null,
  }));
}
