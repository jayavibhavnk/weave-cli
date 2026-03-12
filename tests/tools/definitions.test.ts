import { describe, it, expect } from "vitest";
import {
  builtinTools,
  toOpenAITools,
  toAnthropicTools,
} from "../../src/tools/definitions.js";

describe("tools/definitions", () => {
  it("builtinTools includes read_file and run_command", () => {
    const names = builtinTools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("run_command");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_files");
    expect(names).toContain("search_files");
    expect(names).toContain("github_list_repos");
    expect(names).toContain("github_get_branch");
    expect(names).toContain("github_create_branch");
    expect(names).toContain("github_create_commit");
    expect(names).toContain("github_create_pr");
    expect(names).toContain("github_push_worktree");
  });

  it("each tool has name, description, parameters, requiresApproval", () => {
    for (const t of builtinTools) {
      expect(t.name).toBeTruthy();
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeDefined();
      expect(typeof t.parameters).toBe("object");
      expect(typeof t.requiresApproval).toBe("boolean");
    }
  });

  it("toOpenAITools returns array of function tools", () => {
    const openai = toOpenAITools(builtinTools);
    expect(Array.isArray(openai)).toBe(true);
    expect(openai.length).toBe(builtinTools.length);
    for (const t of openai as { type: string; function: unknown }[]) {
      expect(t.type).toBe("function");
      expect(t.function).toBeDefined();
      expect((t.function as { name: string }).name).toBeTruthy();
    }
  });

  it("toAnthropicTools returns array with name and input_schema", () => {
    const anthropic = toAnthropicTools(builtinTools);
    expect(Array.isArray(anthropic)).toBe(true);
    expect(anthropic.length).toBe(builtinTools.length);
    for (const t of anthropic as { name: string; input_schema: unknown }[]) {
      expect(t.name).toBeTruthy();
      expect(t.input_schema).toBeDefined();
    }
  });
});
