import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  getDefaultConfig,
  resolveApiKey,
  getProviderBaseURL,
  setConfigValue,
  getCodexAuthApiKey,
} from "../src/config.js";
import type { WeaveConfig } from "../src/core/types.js";

describe("config", () => {
  describe("getDefaultConfig", () => {
    it("returns object with expected keys", () => {
      const c = getDefaultConfig();
      expect(c.provider).toBe("openai");
      expect(c.model).toBe("gpt-4o");
      expect(c.embeddingBackend).toBe("local");
      expect(c.embeddingDim).toBe(256);
      expect(typeof c.workspacePath).toBe("string");
      expect(c.githubApiBaseUrl).toBe("https://api.github.com");
    });
  });

  describe("resolveApiKey", () => {
    it("returns apiKey when set", () => {
      expect(resolveApiKey({ ...getDefaultConfig(), apiKey: "sk-x" })).toBe("sk-x");
    });

    it("returns placeholder for ollama without apiKey", () => {
      const config: WeaveConfig = { ...getDefaultConfig(), provider: "ollama" };
      expect(resolveApiKey(config)).toBe("ollama");
    });

    it("returns placeholder for lmstudio without apiKey", () => {
      const config: WeaveConfig = { ...getDefaultConfig(), provider: "lmstudio" };
      expect(resolveApiKey(config)).toBe("ollama");
    });

    it("returns custom apiKey for ollama when set", () => {
      const config: WeaveConfig = {
        ...getDefaultConfig(),
        provider: "ollama",
        apiKey: "custom",
      };
      expect(resolveApiKey(config)).toBe("custom");
    });
  });

  describe("getProviderBaseURL", () => {
    it("returns undefined for openai and anthropic", () => {
      expect(getProviderBaseURL("openai")).toBeUndefined();
      expect(getProviderBaseURL("anthropic")).toBeUndefined();
    });

    it("returns default for ollama when baseURL not passed", () => {
      expect(getProviderBaseURL("ollama")).toBe("http://localhost:11434/v1");
    });

    it("returns default for lmstudio when baseURL not passed", () => {
      expect(getProviderBaseURL("lmstudio")).toBe("http://localhost:1234/v1");
    });

    it("returns custom baseURL when passed", () => {
      expect(getProviderBaseURL("ollama", "http://host:9999/v1")).toBe(
        "http://host:9999/v1"
      );
    });
  });

  describe("setConfigValue", () => {
    it("throws for invalid provider", () => {
      expect(() => setConfigValue("provider", "invalid")).toThrow(
        /Invalid provider/
      );
      expect(() => setConfigValue("provider", "INVALID")).toThrow(
        /Invalid provider/
      );
    });

    it("throws for non-numeric embeddingDim", () => {
      expect(() => setConfigValue("embeddingDim", "abc")).toThrow(
        /embeddingDim must be a number/
      );
    });

    it("throws for invalid githubApiBaseUrl", () => {
      expect(() => setConfigValue("githubApiBaseUrl", "not-a-url")).toThrow(
        /githubApiBaseUrl must be a valid URL/
      );
    });

  });

  describe("getCodexAuthApiKey", () => {
    let tmpDir: string;
    let origCodexHome: string | undefined;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-codex-"));
      origCodexHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = tmpDir;
    });

    afterAll(() => {
      process.env.CODEX_HOME = origCodexHome;
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        /* ignore */
      }
    });

    it("returns undefined when auth file does not exist", () => {
      expect(getCodexAuthApiKey()).toBeUndefined();
    });

    it("returns api_key from auth.json when present", () => {
      const key = "sk-test-key-12345678901234567890";
      fs.writeFileSync(
        path.join(tmpDir, "auth.json"),
        JSON.stringify({ api_key: key }),
        "utf-8"
      );
      expect(getCodexAuthApiKey()).toBe(key);
    });

    it("returns undefined for non-sk prefix", () => {
      fs.writeFileSync(
        path.join(tmpDir, "auth.json"),
        JSON.stringify({ api_key: "invalid-not-sk" }),
        "utf-8"
      );
      expect(getCodexAuthApiKey()).toBeUndefined();
    });
  });
});
