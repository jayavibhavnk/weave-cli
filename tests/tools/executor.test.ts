import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { executeTool } from "../../src/tools/executor.js";

describe("executor", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "weave-exec-"));
    fs.writeFileSync(path.join(cwd, "foo.txt"), "line1\nline2\nline3\n", "utf-8");
    fs.mkdirSync(path.join(cwd, "subdir"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "subdir", "bar.txt"), "bar", "utf-8");
  });

  afterAll(() => {
    try {
      fs.rmSync(cwd, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it("unknown tool returns failure", async () => {
    const r = await executeTool("unknown_tool", {});
    expect(r.success).toBe(false);
    expect(r.output).toContain("Unknown tool");
  });

  it("read_file returns content with line numbers", async () => {
    const r = await executeTool("read_file", { path: "foo.txt" }, cwd);
    expect(r.success).toBe(true);
    expect(r.output).toContain("line1");
    expect(r.output).toContain("1│");
  });

  it("read_file with start_line and end_line", async () => {
    const r = await executeTool(
      "read_file",
      { path: "foo.txt", start_line: 2, end_line: 2 },
      cwd
    );
    expect(r.success).toBe(true);
    expect(r.output).toContain("line2");
  });

  it("read_file for missing file returns error", async () => {
    const r = await executeTool("read_file", { path: "nonexistent.txt" }, cwd);
    expect(r.success).toBe(false);
    expect(r.output).toContain("not found");
  });

  it("write_file creates file", async () => {
    const r = await executeTool(
      "write_file",
      { path: "new.txt", content: "new content" },
      cwd
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(cwd, "new.txt"), "utf-8")).toBe(
      "new content"
    );
  });

  it("edit_file replaces string", async () => {
    const p = path.join(cwd, "editme.txt");
    fs.writeFileSync(p, "old text", "utf-8");
    const r = await executeTool(
      "edit_file",
      { path: "editme.txt", old_string: "old", new_string: "new" },
      cwd
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("new text");
  });

  it("list_files returns directory listing", async () => {
    const r = await executeTool("list_files", { path: "." }, cwd);
    expect(r.success).toBe(true);
    expect(r.output).toContain("foo.txt");
  });

  it("list_files with recursive includes subdir", async () => {
    const r = await executeTool("list_files", { path: ".", recursive: true }, cwd);
    expect(r.success).toBe(true);
    expect(r.output).toContain("bar.txt");
  });

  it("search_files finds pattern", async () => {
    const r = await executeTool("search_files", { pattern: "line2", path: "." }, cwd);
    expect(r.success).toBe(true);
    expect(r.output).toContain("line2");
  });

  it("run_command runs echo", async () => {
    const r = await executeTool("run_command", { command: "echo hello" }, cwd);
    expect(r.success).toBe(true);
    expect(r.output.trim()).toBe("hello");
  });
});
