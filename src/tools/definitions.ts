export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}

export const builtinTools: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a file from the filesystem. Returns the contents with line numbers.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative or absolute file path" },
        start_line: { type: "number", description: "Start line (1-indexed, optional)" },
        end_line: { type: "number", description: "End line (inclusive, optional)" },
      },
      required: ["path"],
    },
    requiresApproval: false,
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Full file content" },
      },
      required: ["path", "content"],
    },
    requiresApproval: true,
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. The old_string must match exactly (including whitespace).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        old_string: { type: "string", description: "Exact string to find" },
        new_string: { type: "string", description: "Replacement string" },
      },
      required: ["path", "old_string", "new_string"],
    },
    requiresApproval: true,
  },
  {
    name: "run_command",
    description:
      "Run a shell command and return stdout/stderr. Use for git, npm, tests, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        cwd: { type: "string", description: "Working directory (optional)" },
      },
      required: ["command"],
    },
    requiresApproval: true,
  },
  {
    name: "list_files",
    description:
      "List files in a directory. Returns file paths, one per line.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path", default: "." },
        recursive: { type: "boolean", description: "List recursively", default: false },
        pattern: { type: "string", description: "Filter by extension (e.g. '.ts')" },
      },
      required: [],
    },
    requiresApproval: false,
  },
  {
    name: "search_files",
    description:
      "Search for a regex pattern across files. Returns matching lines with file paths and line numbers.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory to search in", default: "." },
        file_pattern: { type: "string", description: "Filter files by extension (e.g. '.ts')" },
      },
      required: ["pattern"],
    },
    requiresApproval: false,
  },
  {
    name: "github_list_repos",
    description: "List repositories accessible to the configured GitHub App installation.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub owner or organization" },
        repo: { type: "string", description: "Repository used to resolve installation access" },
      },
      required: [],
    },
    requiresApproval: true,
  },
  {
    name: "github_get_branch",
    description: "Get the latest commit SHA for a branch.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub owner or organization" },
        repo: { type: "string", description: "GitHub repository" },
        branch: { type: "string", description: "Branch name" },
      },
      required: ["branch"],
    },
    requiresApproval: true,
  },
  {
    name: "github_create_branch",
    description: "Create a branch in GitHub via the GitHub App.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub owner or organization" },
        repo: { type: "string", description: "GitHub repository" },
        branch: { type: "string", description: "Branch name to create" },
        base_branch: { type: "string", description: "Base branch to branch from" },
      },
      required: ["branch"],
    },
    requiresApproval: true,
  },
  {
    name: "github_create_pr",
    description: "Create a pull request via the GitHub App.",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub owner or organization" },
        repo: { type: "string", description: "GitHub repository" },
        title: { type: "string", description: "Pull request title" },
        body: { type: "string", description: "Pull request body" },
        head: { type: "string", description: "Head branch" },
        base: { type: "string", description: "Base branch" },
      },
      required: ["title", "head"],
    },
    requiresApproval: true,
  },
  {
    name: "github_push",
    description: "Commit all changes as the weave-cli bot identity and push to a branch. Uses the user's existing git credentials for the push; the commit author is set to the bot so it appears as a contributor.",
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Target branch name" },
        message: { type: "string", description: "Commit message" },
        dir: { type: "string", description: "Local git repository directory" },
        bot_username: { type: "string", description: "Bot GitHub username (defaults to weave-cli)" },
      },
      required: ["branch", "message"],
    },
    requiresApproval: true,
  },
];

export function toOpenAITools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toAnthropicTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
