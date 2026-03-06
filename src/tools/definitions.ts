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
