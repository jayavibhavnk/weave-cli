import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ToolDef } from "./definitions.js";

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPClient {
  private servers = new Map<string, { proc: ChildProcess; tools: ToolDef[] }>();
  private nextId = 1;
  private toolToServer = new Map<string, string>();

  async loadConfig(): Promise<MCPConfig | null> {
    const configPath = path.join(os.homedir(), ".weave", "mcp.json");
    if (!fs.existsSync(configPath)) return null;
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async connectAll(): Promise<ToolDef[]> {
    const config = await this.loadConfig();
    if (!config) return [];

    const allTools: ToolDef[] = [];
    for (const [name, serverConfig] of Object.entries(config.servers)) {
      try {
        const tools = await this.connectServer(name, serverConfig);
        allTools.push(...tools);
      } catch {
        /* skip failed servers */
      }
    }
    return allTools;
  }

  private async connectServer(
    name: string,
    config: MCPServerConfig
  ): Promise<ToolDef[]> {
    const proc = spawn(config.command, config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });

    await this.sendRequest(proc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "weave", version: "0.3.0" },
    });

    await this.sendNotification(proc, "notifications/initialized", {});

    const toolsResp = (await this.sendRequest(proc, "tools/list", {})) as {
      tools: { name: string; description: string; inputSchema: unknown }[];
    };

    const tools: ToolDef[] = (toolsResp.tools || []).map((t) => {
      const toolName = `mcp_${name}_${t.name}`;
      this.toolToServer.set(toolName, name);
      return {
        name: toolName,
        description: `[MCP:${name}] ${t.description}`,
        parameters: t.inputSchema as Record<string, unknown>,
        requiresApproval: true,
      };
    });

    this.servers.set(name, { proc, tools });
    return tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const serverName = this.toolToServer.get(toolName);
    if (!serverName) return `MCP server not found for tool: ${toolName}`;

    const server = this.servers.get(serverName);
    if (!server) return `MCP server ${serverName} not connected`;

    const originalName = toolName.replace(`mcp_${serverName}_`, "");
    const result = (await this.sendRequest(server.proc, "tools/call", {
      name: originalName,
      arguments: args,
    })) as { content: { type: string; text?: string }[] };

    return (
      result.content
        ?.map((c) => c.text || "")
        .filter(Boolean)
        .join("\n") || "(no output)"
    );
  }

  isMCPTool(name: string): boolean {
    return this.toolToServer.has(name);
  }

  private sendRequest(
    proc: ChildProcess,
    method: string,
    params: unknown
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req: JSONRPCRequest = { jsonrpc: "2.0", id, method, params };
      const line = JSON.stringify(req) + "\n";

      const timeout = setTimeout(() => reject(new Error("MCP timeout")), 10000);

      const onData = (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const l of lines) {
          try {
            const resp: JSONRPCResponse = JSON.parse(l);
            if (resp.id === id) {
              clearTimeout(timeout);
              proc.stdout?.off("data", onData);
              if (resp.error) reject(new Error(resp.error.message));
              else resolve(resp.result);
            }
          } catch {}
        }
      };

      proc.stdout?.on("data", onData);
      proc.stdin?.write(line);
    });
  }

  private sendNotification(
    proc: ChildProcess,
    method: string,
    params: unknown
  ): Promise<void> {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    proc.stdin?.write(msg);
    return Promise.resolve();
  }

  close(): void {
    for (const [, server] of this.servers) {
      server.proc.kill();
    }
    this.servers.clear();
  }
}
