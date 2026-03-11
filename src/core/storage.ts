import type {
  MemoryNode,
  MemoryEdge,
  AgentPersona,
  AgentState,
} from "./types.js";
import type {
  AutomationRecord,
  AutomationRunRecord,
} from "../testing/automation-types.js";

export class Storage {
  private db: any;

  private constructor(db: any) {
    this.db = db;
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  static async create(dbPath: string): Promise<Storage> {
    const { default: BetterSqlite3 } = await import("better-sqlite3");
    const db = new BetterSqlite3(dbPath);
    return new Storage(db);
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        tier TEXT NOT NULL,
        scope TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        importance REAL NOT NULL,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER NOT NULL,
        decay_rate REAL NOT NULL,
        entities TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id, edge_type)
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        persona TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_agent ON nodes(agent_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_tier ON nodes(tier);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        trigger_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER,
        failure_count INTEGER NOT NULL,
        max_failures INTEGER NOT NULL,
        last_status TEXT,
        last_summary TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        summary TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_automations_enabled_next
        ON automations(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
        ON automation_runs(automation_id, started_at);
    `);
  }

  saveNode(node: MemoryNode): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO nodes
        (id, content, memory_type, tier, scope, agent_id, importance,
         embedding, created_at, last_accessed, access_count, decay_rate,
         entities, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        node.id,
        node.content,
        node.memoryType,
        node.tier,
        node.scope,
        node.agentId,
        node.importance,
        JSON.stringify(node.embedding),
        node.createdAt,
        node.lastAccessed,
        node.accessCount,
        node.decayRate,
        JSON.stringify(node.entities),
        JSON.stringify(node.metadata)
      );
  }

  saveNodes(nodes: MemoryNode[]): void {
    const txn = this.db.transaction((items: MemoryNode[]) => {
      for (const node of items) this.saveNode(node);
    });
    txn(nodes);
  }

  loadNodes(): MemoryNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes").all() as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  loadNodesByAgent(agentId: string): MemoryNode[] {
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE agent_id = ?")
      .all(agentId) as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM edges WHERE source_id = ? OR target_id = ?").run(id, id);
  }

  saveEdge(edge: MemoryEdge): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO edges (source_id, target_id, edge_type, weight, created_at)
        VALUES (?, ?, ?, ?, ?)`
      )
      .run(edge.sourceId, edge.targetId, edge.edgeType, edge.weight, edge.createdAt);
  }

  saveEdges(edges: MemoryEdge[]): void {
    const txn = this.db.transaction((items: MemoryEdge[]) => {
      for (const edge of items) this.saveEdge(edge);
    });
    txn(edges);
  }

  loadEdges(): MemoryEdge[] {
    const rows = this.db.prepare("SELECT * FROM edges").all() as Record<string, unknown>[];
    return rows.map(rowToEdge);
  }

  saveAgent(id: string, persona: AgentPersona): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agents (id, persona, created_at, last_active)
        VALUES (?, ?, ?, ?)`
      )
      .run(id, JSON.stringify(persona), Date.now(), Date.now());
  }

  loadAgents(): AgentState[] {
    const rows = this.db.prepare("SELECT * FROM agents").all() as Record<string, unknown>[];
    return rows.map((r) => {
      const nodes = this.db
        .prepare("SELECT COUNT(*) as cnt FROM nodes WHERE agent_id = ?")
        .get(r.id as string) as { cnt: number };
      return {
        id: r.id as string,
        persona: JSON.parse(r.persona as string) as AgentPersona,
        createdAt: r.created_at as number,
        lastActive: r.last_active as number,
        memoryCount: nodes.cnt,
      };
    });
  }

  loadAgent(id: string): AgentState | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const nodes = this.db
      .prepare("SELECT COUNT(*) as cnt FROM nodes WHERE agent_id = ?")
      .get(id) as { cnt: number };
    return {
      id: row.id as string,
      persona: JSON.parse(row.persona as string) as AgentPersona,
      createdAt: row.created_at as number,
      lastActive: row.last_active as number,
      memoryCount: nodes.cnt,
    };
  }

  deleteAgent(id: string): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM nodes WHERE agent_id = ?").run(id);
  }

  updateAgentActivity(id: string): void {
    this.db.prepare("UPDATE agents SET last_active = ? WHERE id = ?").run(Date.now(), id);
  }

  saveAutomation(record: AutomationRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO automations
        (id, name, enabled, trigger_json, target_json, created_at, updated_at,
         last_run_at, next_run_at, failure_count, max_failures, last_status, last_summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.name,
        record.enabled ? 1 : 0,
        JSON.stringify(record.trigger),
        JSON.stringify(record.target),
        record.createdAt,
        record.updatedAt,
        record.lastRunAt ?? null,
        record.nextRunAt ?? null,
        record.failureCount,
        record.maxFailures,
        record.lastStatus ?? null,
        record.lastSummary ?? null
      );
  }

  loadAutomations(): AutomationRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM automations ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];
    return rows.map(rowToAutomation);
  }

  loadAutomation(id: string): AutomationRecord | null {
    const row = this.db
      .prepare("SELECT * FROM automations WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToAutomation(row) : null;
  }

  deleteAutomation(id: string): void {
    this.db.prepare("DELETE FROM automation_runs WHERE automation_id = ?").run(id);
    this.db.prepare("DELETE FROM automations WHERE id = ?").run(id);
  }

  saveAutomationRun(run: AutomationRunRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO automation_runs
        (id, automation_id, started_at, ended_at, status, summary)
        VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.automationId,
        run.startedAt,
        run.endedAt ?? null,
        run.status,
        run.summary
      );
  }

  loadAutomationRuns(automationId?: string): AutomationRunRecord[] {
    const rows = automationId
      ? (this.db
          .prepare(
            "SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC"
          )
          .all(automationId) as Record<string, unknown>[])
      : (this.db
          .prepare("SELECT * FROM automation_runs ORDER BY started_at DESC")
          .all() as Record<string, unknown>[]);
    return rows.map(rowToAutomationRun);
  }

  saveAll(nodes: MemoryNode[], edges: MemoryEdge[]): void {
    const txn = this.db.transaction(() => {
      for (const node of nodes) this.saveNode(node);
      for (const edge of edges) this.saveEdge(edge);
    });
    txn();
  }

  close(): void {
    this.db.close();
  }
}

function rowToNode(row: Record<string, unknown>): MemoryNode {
  return {
    id: row.id as string,
    content: row.content as string,
    memoryType: row.memory_type as MemoryNode["memoryType"],
    tier: row.tier as MemoryNode["tier"],
    scope: row.scope as MemoryNode["scope"],
    agentId: row.agent_id as string,
    importance: row.importance as number,
    embedding: JSON.parse(row.embedding as string),
    createdAt: row.created_at as number,
    lastAccessed: row.last_accessed as number,
    accessCount: row.access_count as number,
    decayRate: row.decay_rate as number,
    entities: JSON.parse(row.entities as string),
    metadata: JSON.parse(row.metadata as string),
  };
}

function rowToEdge(row: Record<string, unknown>): MemoryEdge {
  return {
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    edgeType: row.edge_type as MemoryEdge["edgeType"],
    weight: row.weight as number,
    createdAt: row.created_at as number,
  };
}

function rowToAutomation(row: Record<string, unknown>): AutomationRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    enabled: Boolean(row.enabled),
    trigger: JSON.parse(row.trigger_json as string),
    target: JSON.parse(row.target_json as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    lastRunAt:
      row.last_run_at === null || row.last_run_at === undefined
        ? undefined
        : (row.last_run_at as number),
    nextRunAt:
      row.next_run_at === null || row.next_run_at === undefined
        ? undefined
        : (row.next_run_at as number),
    failureCount: row.failure_count as number,
    maxFailures: row.max_failures as number,
    lastStatus:
      row.last_status === null || row.last_status === undefined
        ? undefined
        : (row.last_status as AutomationRecord["lastStatus"]),
    lastSummary:
      row.last_summary === null || row.last_summary === undefined
        ? undefined
        : (row.last_summary as string),
  };
}

function rowToAutomationRun(row: Record<string, unknown>): AutomationRunRecord {
  return {
    id: row.id as string,
    automationId: row.automation_id as string,
    startedAt: row.started_at as number,
    endedAt:
      row.ended_at === null || row.ended_at === undefined
        ? undefined
        : (row.ended_at as number),
    status: row.status as AutomationRunRecord["status"],
    summary: row.summary as string,
  };
}
