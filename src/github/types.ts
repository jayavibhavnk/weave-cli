export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  apiBaseUrl: string;
  owner?: string;
  repo?: string;
}

export interface GithubInstallation {
  id: number;
  account: {
    login: string;
  };
  repositories_url?: string;
}

export interface GithubInstallationToken {
  token: string;
  expires_at: string;
}

export interface GithubRepoRef {
  ref: string;
  sha: string;
}

export interface GithubBlobResult {
  sha: string;
}

export interface GithubTreeEntryInput {
  path: string;
  mode: "100644" | "100755" | "040000" | "120000";
  type: "blob" | "tree" | "commit";
  sha: string | null;
}

export interface GithubTreeResult {
  sha: string;
}

export interface GithubCommitResult {
  sha: string;
  html_url?: string;
}

export interface GithubPullRequestResult {
  number: number;
  html_url: string;
}

export interface GithubFileInput {
  repoPath: string;
  content: string;
}
