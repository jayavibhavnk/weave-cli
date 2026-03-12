import * as fs from "node:fs";
import * as crypto from "node:crypto";
import type { WeaveConfig } from "../core/types.js";
import { getGithubApiBaseUrl, getGithubBotToken } from "../config.js";
import type { GithubAppConfig, GithubTokenConfig } from "./types.js";

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function loadGithubAppConfig(config: WeaveConfig): GithubAppConfig | null {
  const appId = config.githubAppId || process.env.GITHUB_APP_ID;
  const inlineKey = config.githubAppPrivateKey || process.env.GITHUB_APP_PRIVATE_KEY;
  const keyPath = config.githubAppPrivateKeyPath || process.env.GITHUB_APP_PRIVATE_KEY_PATH;

  let privateKey = inlineKey ? normalizePrivateKey(inlineKey) : "";
  if (!privateKey && keyPath && fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, "utf-8");
  }

  if (!appId || !privateKey) return null;

  return {
    appId,
    privateKey,
    apiBaseUrl: getGithubApiBaseUrl(config),
    owner: config.githubOwner || process.env.GITHUB_OWNER,
    repo: config.githubRepo || process.env.GITHUB_REPO,
  };
}

export function loadGithubTokenConfig(config: WeaveConfig): GithubTokenConfig | null {
  const token = getGithubBotToken(config);
  if (!token) return null;
  return {
    token,
    apiBaseUrl: getGithubApiBaseUrl(config),
    owner: config.githubOwner || process.env.GITHUB_OWNER,
    repo: config.githubRepo || process.env.GITHUB_REPO,
    username:
      config.githubBotUsername ||
      process.env.WEAVE_TEST_GITHUB_BOT_USERNAME ||
      process.env.GITHUB_ACTOR,
  };
}

export function createGithubAppJwt(
  appId: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}
