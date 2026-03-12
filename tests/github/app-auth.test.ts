import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createGithubAppJwt,
  loadGithubAppConfig,
  loadGithubTokenConfig,
  normalizePrivateKey,
} from "../../src/github/app-auth.js";
import { getDefaultConfig } from "../../src/config.js";

describe("github app auth", () => {
  it("normalizes escaped newlines", () => {
    expect(normalizePrivateKey("a\\nb")).toBe("a\nb");
  });

  it("creates a signed JWT with expected payload", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwt = createGithubAppJwt(
      "12345",
      privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      1_700_000_000
    );

    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf-8")) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf-8")).alg).toBe("RS256");
    expect(payload.iss).toBe("12345");
    expect(payload.exp).toBeGreaterThan(payload.iat);

    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(`${headerPart}.${payloadPart}`);
    verify.end();
    expect(
      verify.verify(publicKey.export({ type: "pkcs1", format: "pem" }), Buffer.from(signaturePart, "base64url"))
    ).toBe(true);
  });

  it("loads app config from private key path", () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-gh-auth-"));
    const pemPath = path.join(dir, "app.pem");
    fs.writeFileSync(pemPath, pem, "utf-8");

    const config = loadGithubAppConfig({
      ...getDefaultConfig(),
      githubAppId: "1",
      githubAppPrivateKeyPath: pemPath,
      githubOwner: "acme",
      githubRepo: "repo",
    });

    expect(config).not.toBeNull();
    expect(config!.appId).toBe("1");
    expect(config!.privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect(config!.owner).toBe("acme");
  });

  it("loads token config from env", () => {
    const originalToken = process.env.WEAVE_TEST_GITHUB_BOT_TOKEN;
    const originalUser = process.env.WEAVE_TEST_GITHUB_BOT_USERNAME;
    process.env.WEAVE_TEST_GITHUB_BOT_TOKEN = "bot-token";
    process.env.WEAVE_TEST_GITHUB_BOT_USERNAME = "weave-bot";

    try {
      const config = loadGithubTokenConfig({
        ...getDefaultConfig(),
        githubOwner: "acme",
        githubRepo: "repo",
        githubAuthMode: "token",
      });
      expect(config).not.toBeNull();
      expect(config!.token).toBe("bot-token");
      expect(config!.username).toBe("weave-bot");
      expect(config!.owner).toBe("acme");
    } finally {
      if (originalToken === undefined) delete process.env.WEAVE_TEST_GITHUB_BOT_TOKEN;
      else process.env.WEAVE_TEST_GITHUB_BOT_TOKEN = originalToken;
      if (originalUser === undefined) delete process.env.WEAVE_TEST_GITHUB_BOT_USERNAME;
      else process.env.WEAVE_TEST_GITHUB_BOT_USERNAME = originalUser;
    }
  });
});
