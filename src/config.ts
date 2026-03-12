import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WeaveConfig, LLMProviderName } from "./core/types.js";

const CONFIG_DIR = path.join(os.homedir(), ".weave");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const WORKSPACES_DIR = path.join(CONFIG_DIR, "workspaces");

function getCodexAuthPath(): string {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "auth.json");
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(WORKSPACES_DIR))
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

export function getDefaultConfig(): WeaveConfig {
  return {
    provider: "openai",
    apiKey: undefined,
    model: "gpt-4o",
    embeddingModel: "text-embedding-3-small",
    embeddingBackend: "local",
    embeddingDim: 256,
    defaultAgent: "assistant",
    workspacePath: path.join(WORKSPACES_DIR, "default.db"),
    githubApiBaseUrl: "https://api.github.com",
    githubAuthMode: "app",
  };
}

export function loadConfig(): WeaveConfig {
  ensureConfigDir();
  const defaults = getDefaultConfig();
  let config = defaults;

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const saved = JSON.parse(raw);
      config = { ...defaults, ...saved };
    } catch {
      config = defaults;
    }
  }

  // Check environment variables
  const envKey =
    process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    config.apiKey = envKey;
    if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      config.provider = "anthropic";
      config.model = "claude-sonnet-4-20250514";
    }
  }

  if (process.env.GITHUB_APP_ID) config.githubAppId = process.env.GITHUB_APP_ID;
  if (process.env.GITHUB_APP_PRIVATE_KEY)
    config.githubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (process.env.GITHUB_APP_PRIVATE_KEY_PATH)
    config.githubAppPrivateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (process.env.GITHUB_OWNER) config.githubOwner = process.env.GITHUB_OWNER;
  if (process.env.GITHUB_REPO) config.githubRepo = process.env.GITHUB_REPO;
  if (process.env.GITHUB_API_BASE_URL)
    config.githubApiBaseUrl = process.env.GITHUB_API_BASE_URL;
  if (process.env.WEAVE_TEST_GITHUB_AUTH_MODE === "app" || process.env.WEAVE_TEST_GITHUB_AUTH_MODE === "token") {
    config.githubAuthMode = process.env.WEAVE_TEST_GITHUB_AUTH_MODE;
  }
  if (process.env.WEAVE_TEST_GITHUB_BOT_USERNAME) {
    config.githubBotUsername = process.env.WEAVE_TEST_GITHUB_BOT_USERNAME;
  }

  return config;
}

export function saveConfig(config: Partial<WeaveConfig>): void {
  ensureConfigDir();
  const existing = loadConfig();
  const merged = { ...existing, ...config };

  // Don't persist workspacePath if it's the default
  const toSave: Record<string, unknown> = {};
  const defaults = getDefaultConfig();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== (defaults as unknown as Record<string, unknown>)[key]) {
      toSave[key] = value;
    }
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2) + "\n");
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  return (config as unknown as Record<string, unknown>)[key];
}

const VALID_PROVIDERS: LLMProviderName[] = ["openai", "anthropic", "ollama", "lmstudio"];
const VALID_GITHUB_AUTH_MODES = ["app", "token"] as const;

export function setConfigValue(key: string, value: string): void {
  const update: Record<string, unknown> = {};

  if (key === "embeddingDim") {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) throw new Error("embeddingDim must be a number");
    update[key] = n;
  } else if (key === "provider") {
    const p = value.toLowerCase();
    if (!VALID_PROVIDERS.includes(p as LLMProviderName)) {
      throw new Error(`Invalid provider: ${value}. Use one of: ${VALID_PROVIDERS.join(", ")}`);
    }
    update[key] = p;
  } else if (key === "githubApiBaseUrl") {
    try {
      // Validate URL shape early.
      new URL(value);
    } catch {
      throw new Error("githubApiBaseUrl must be a valid URL");
    }
    update[key] = value.replace(/\/$/, "");
  } else if (key === "githubAuthMode") {
    if (!VALID_GITHUB_AUTH_MODES.includes(value as (typeof VALID_GITHUB_AUTH_MODES)[number])) {
      throw new Error(`githubAuthMode must be one of: ${VALID_GITHUB_AUTH_MODES.join(", ")}`);
    }
    update[key] = value;
  } else {
    update[key] = value;
  }

  saveConfig(update as Partial<WeaveConfig>);
}

export function getWorkspacePath(name = "default"): string {
  ensureConfigDir();
  return path.join(WORKSPACES_DIR, `${name}.db`);
}

export function listWorkspaces(): string[] {
  ensureConfigDir();
  try {
    return fs
      .readdirSync(WORKSPACES_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => f.replace(".db", ""));
  } catch {
    return [];
  }
}

/**
 * Try to read OpenAI API key from Codex's auth.json (e.g. after `codex login --api-key`).
 * See: https://developers.openai.com/codex/auth/
 */
export function getCodexAuthApiKey(): string | undefined {
  try {
    const authPath = getCodexAuthPath();
    if (!fs.existsSync(authPath)) return undefined;
    const raw = fs.readFileSync(authPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [
      data.api_key,
      data.apiKey,
      data.openai_api_key,
      (data.credentials as Record<string, unknown>)?.api_key,
    ];
    for (const v of candidates) {
      if (typeof v === "string" && v.startsWith("sk-") && v.length > 20) {
        return v;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function resolveApiKey(config: WeaveConfig): string | undefined {
  if (config.provider === "ollama" || config.provider === "lmstudio") {
    return config.apiKey ?? "ollama";
  }
  if (config.apiKey) return config.apiKey;
  if (config.provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  if (config.provider === "openai" && config.useCodexAuth !== false) {
    return getCodexAuthApiKey();
  }
  return undefined;
}

export function getProviderBaseURL(
  provider: LLMProviderName,
  baseURL?: string
): string | undefined {
  if (provider !== "ollama" && provider !== "lmstudio") return undefined;
  if (baseURL) return baseURL;
  return provider === "ollama"
    ? "http://localhost:11434/v1"
    : "http://localhost:1234/v1";
}

export function getGithubApiBaseUrl(config?: Partial<WeaveConfig>): string {
  return config?.githubApiBaseUrl || process.env.GITHUB_API_BASE_URL || "https://api.github.com";
}

export function getGithubBotToken(config?: Partial<WeaveConfig>): string | undefined {
  return (
    process.env.WEAVE_TEST_GITHUB_BOT_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN
  );
}
