import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { loadConfig } from "../config.js";
import {
  createGithubBranch,
  createGithubCommitFromFiles,
  createGithubPullRequest,
  getGithubBranchInfo,
  listConnectedRepos,
  pushGithubWorktree,
} from "../github/write-flow.js";

export interface ToolResult {
  success: boolean;
  output: string;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd?: string
): Promise<ToolResult> {
  try {
    switch (name) {
      case "read_file":
        return readFile(
          String(args.path),
          args.start_line as number | undefined,
          args.end_line as number | undefined,
          cwd
        );
      case "write_file":
        return writeFile(String(args.path), String(args.content), cwd);
      case "edit_file":
        return editFile(
          String(args.path),
          String(args.old_string),
          String(args.new_string),
          cwd
        );
      case "run_command":
        return runCommand(String(args.command), (args.cwd as string) || cwd);
      case "list_files":
        return listFiles(
          String(args.path || "."),
          Boolean(args.recursive),
          args.pattern as string | undefined,
          cwd
        );
      case "search_files":
        return searchFiles(
          String(args.pattern),
          String(args.path || "."),
          args.file_pattern as string | undefined,
          cwd
        );
      case "github_list_repos": {
        const config = loadConfig();
        const repos = await listConnectedRepos(
          config,
          args.owner as string | undefined,
          args.repo as string | undefined
        );
        return {
          success: true,
          output: repos.map((repo) => `${repo.full_name} (${repo.default_branch || "-"})`).join("\n") || "(no repos)",
        };
      }
      case "github_get_branch": {
        const config = loadConfig();
        const result = await getGithubBranchInfo(config, {
          owner: args.owner as string | undefined,
          repo: args.repo as string | undefined,
          branch: String(args.branch),
        });
        return {
          success: true,
          output: `${result.owner}/${result.repo} ${result.branch} ${result.sha}`,
        };
      }
      case "github_create_branch": {
        const config = loadConfig();
        const result = await createGithubBranch(config, {
          owner: args.owner as string | undefined,
          repo: args.repo as string | undefined,
          branch: String(args.branch),
          baseBranch: args.base_branch as string | undefined,
        });
        return {
          success: true,
          output: `Created ${result.owner}/${result.repo}#${result.branch} at ${result.sha}`,
        };
      }
      case "github_create_commit": {
        const config = loadConfig();
        const filePaths = Array.isArray(args.file_paths)
          ? args.file_paths.map((item) => String(item))
          : [];
        const result = await createGithubCommitFromFiles(config, {
          owner: args.owner as string | undefined,
          repo: args.repo as string | undefined,
          branch: String(args.branch),
          message: String(args.message),
          dir: String(args.dir),
          filePaths,
        });
        return {
          success: true,
          output: `Committed ${result.changedFiles.join(", ")} to ${result.owner}/${result.repo}@${result.branch} (${result.commitSha})`,
        };
      }
      case "github_create_pr": {
        const config = loadConfig();
        const result = await createGithubPullRequest(config, {
          owner: args.owner as string | undefined,
          repo: args.repo as string | undefined,
          title: String(args.title),
          body: args.body ? String(args.body) : "",
          head: String(args.head),
          base: args.base as string | undefined,
        });
        return {
          success: true,
          output: `Created PR #${result.number}: ${result.html_url}`,
        };
      }
      case "github_push_worktree": {
        const config = loadConfig();
        const result = await pushGithubWorktree(config, {
          owner: args.owner as string | undefined,
          repo: args.repo as string | undefined,
          branch: String(args.branch),
          message: String(args.message),
          dir: String(args.dir),
          createBranchIfMissing: Boolean(args.create_branch_if_missing),
          baseBranch: args.base_branch as string | undefined,
        });
        return {
          success: true,
          output: `Pushed worktree changes to ${result.owner}/${result.repo}@${result.branch} (${result.commitSha})\n${result.changedFiles.join("\n")}`,
        };
      }
      default:
        return { success: false, output: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Error: ${msg}` };
  }
}

function resolve(p: string, cwd?: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(cwd || process.cwd(), p);
}

function readFile(
  filePath: string,
  startLine?: number,
  endLine?: number,
  cwd?: string
): ToolResult {
  const full = resolve(filePath, cwd);
  if (!fs.existsSync(full)) {
    return { success: false, output: `File not found: ${filePath}` };
  }
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    return { success: false, output: `${filePath} is a directory, not a file` };
  }
  if (stat.size > 1_000_000) {
    return {
      success: false,
      output: `File too large (${(stat.size / 1024).toFixed(0)}KB). Use start_line/end_line to read a section.`,
    };
  }
  const content = fs.readFileSync(full, "utf-8");
  const lines = content.split("\n");

  const start = Math.max(1, startLine || 1);
  const end = Math.min(lines.length, endLine || lines.length);
  const selected = lines.slice(start - 1, end);

  const numbered = selected
    .map((line, i) => `${String(start + i).padStart(4)}│ ${line}`)
    .join("\n");

  return {
    success: true,
    output: `${filePath} (lines ${start}-${end} of ${lines.length})\n${numbered}`,
  };
}

function writeFile(filePath: string, content: string, cwd?: string): ToolResult {
  const full = resolve(filePath, cwd);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  const lines = content.split("\n").length;
  return { success: true, output: `Wrote ${lines} lines to ${filePath}` };
}

function editFile(
  filePath: string,
  oldStr: string,
  newStr: string,
  cwd?: string
): ToolResult {
  const full = resolve(filePath, cwd);
  if (!fs.existsSync(full)) {
    return { success: false, output: `File not found: ${filePath}` };
  }
  const content = fs.readFileSync(full, "utf-8");
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    return {
      success: false,
      output: `String not found in ${filePath}. Make sure old_string matches exactly.`,
    };
  }
  if (content.indexOf(oldStr, idx + 1) !== -1) {
    return {
      success: false,
      output: `Multiple matches found in ${filePath}. Provide more context to make it unique.`,
    };
  }
  const updated = content.replace(oldStr, newStr);
  fs.writeFileSync(full, updated, "utf-8");
  return { success: true, output: `Edited ${filePath}: replaced ${oldStr.split("\n").length} lines` };
}

function runCommand(command: string, cwd?: string): ToolResult {
  try {
    const output = execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      success: true,
      output: output.length > 5000
        ? output.substring(0, 5000) + "\n... (truncated)"
        : output || "(no output)",
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n");
    return {
      success: false,
      output: `Exit code ${e.status || 1}\n${out.substring(0, 3000)}`,
    };
  }
}

function listFiles(
  dirPath: string,
  recursive: boolean,
  pattern?: string,
  cwd?: string
): ToolResult {
  const full = resolve(dirPath, cwd);
  if (!fs.existsSync(full)) {
    return { success: false, output: `Directory not found: ${dirPath}` };
  }

  const results: string[] = [];
  const ignored = new Set(["node_modules", ".git", "dist", "__pycache__", ".next", ".venv"]);

  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (recursive) walk(path.join(dir, entry.name), rel);
        else results.push(rel + "/");
      } else {
        if (pattern && !entry.name.endsWith(pattern)) continue;
        results.push(rel);
      }
    }
  }

  walk(full, "");
  if (results.length > 200) {
    return {
      success: true,
      output: results.slice(0, 200).join("\n") + `\n... (${results.length - 200} more files)`,
    };
  }
  return { success: true, output: results.join("\n") || "(empty directory)" };
}

function searchFiles(
  pattern: string,
  dirPath: string,
  filePattern?: string,
  cwd?: string
): ToolResult {
  const full = resolve(dirPath, cwd);
  if (!fs.existsSync(full)) {
    return { success: false, output: `Directory not found: ${dirPath}` };
  }

  const regex = new RegExp(pattern, "gi");
  const matches: string[] = [];
  const ignored = new Set(["node_modules", ".git", "dist", "__pycache__", ".next"]);
  const MAX_MATCHES = 50;

  function walk(dir: string) {
    if (matches.length >= MAX_MATCHES) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) return;
      if (ignored.has(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
      } else {
        if (filePattern && !entry.name.endsWith(filePattern)) continue;
        try {
          const stat = fs.statSync(filePath);
          if (stat.size > 500_000) continue;
          const content = fs.readFileSync(filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
            if (regex.test(lines[i])) {
              const rel = path.relative(full, filePath);
              matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
            }
            regex.lastIndex = 0;
          }
        } catch {
          /* skip binary/unreadable files */
        }
      }
    }
  }

  walk(full);
  if (matches.length === 0) {
    return { success: true, output: `No matches found for /${pattern}/` };
  }
  const suffix = matches.length >= MAX_MATCHES ? `\n... (showing first ${MAX_MATCHES} matches)` : "";
  return { success: true, output: matches.join("\n") + suffix };
}
