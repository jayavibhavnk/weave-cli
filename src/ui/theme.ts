import chalk from "chalk";

export const colors = {
  brand: "#7C5CFC",
  brandDim: "#5B3FD9",
  user: "#60A5FA",
  agent: "#F472B6",
  memory: "#34D399",
  memoryDim: "#059669",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  errorDim: "#DC2626",
  muted: "#6B7280",
  dimmed: "#4B5563",
  surface: "#2D2D2D",
  text: "#E5E7EB",
  textBright: "#F9FAFB",
  accent: "#38BDF8",
  label: "#A78BFA",
  causal: "#FB923C",
};

export const icons = {
  weave: "◈",
  dot: "●",
  diamond: "◆",
  arrow: "›",
  arrowRight: "→",
  check: "✓",
  cross: "✗",
  plus: "+",
  minus: "−",
  pipe: "│",
  pipeThin: "┊",
  corner: "╰",
  tee: "├",
  dash: "─",
  ellipsis: "…",
  brain: "◎",
  star: "★",
  link: "⟶",
  cursor: "█",
  prompt: "❯",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

const thinkingVerbs = [
  "thinking",
  "reasoning",
  "considering",
  "processing",
  "analyzing",
  "reflecting",
  "evaluating",
  "pondering",
];

export function getThinkingVerb(): string {
  return thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
}

export const t = {
  brand: chalk.hex(colors.brand),
  brandBold: chalk.hex(colors.brand).bold,
  accent: chalk.hex(colors.accent),
  success: chalk.hex(colors.success),
  warning: chalk.hex(colors.warning),
  error: chalk.hex(colors.error),
  dim: chalk.dim,
  dimItalic: chalk.dim.italic,
  bold: chalk.bold,
  italic: chalk.italic,
  muted: chalk.hex(colors.muted),
  white: chalk.white,
  label: chalk.hex(colors.label),
  memory: chalk.hex(colors.memory),
  agent: chalk.hex(colors.agent),
  user: chalk.hex(colors.user),
};

export function banner(version: string): string {
  return [
    "",
    `  ${t.brand("◈")} ${t.brandBold("weave")} ${t.dim(`v${version}`)}`,
    `  ${t.dim("graph-native memory for AI agents")}`,
    "",
  ].join("\n");
}

export function table(
  headers: string[],
  rows: string[][],
  colWidths?: number[]
): string {
  const widths =
    colWidths ||
    headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] || "").length))
    );

  const pad = (s: string, w: number) => {
    const visible = stripAnsi(s).length;
    return s + " ".repeat(Math.max(0, w - visible));
  };

  const lines: string[] = [];
  lines.push(
    "  " + headers.map((h, i) => t.label(pad(h, widths[i]))).join("  ")
  );
  lines.push("  " + widths.map((w) => t.muted("─".repeat(w))).join("  "));
  for (const row of rows) {
    lines.push("  " + row.map((c, i) => pad(c, widths[i])).join("  "));
  }
  return lines.join("\n");
}

export function successLine(msg: string): string {
  return `  ${t.success(icons.check)} ${msg}`;
}

export function errorLine(msg: string): string {
  return `  ${t.error(icons.cross)} ${t.error(msg)}`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
