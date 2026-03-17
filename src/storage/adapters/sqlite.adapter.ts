import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateId } from '../types.js'
import type { StorageAdapter } from '../interface.js'
import type { Task, Subtask, Session, Checkpoint, TaskListFilter } from '../types.js'
import type { TaskCreateInput, TaskUpdateInput, SubtaskCreateItem } from '../interface.js'

const defaultContext = { workingDirectory: '/tmp', initScript: null, repoUrl: null, environmentVars: {} }

const initSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      phase TEXT DEFAULT 'init',
      priority INTEGER DEFAULT 5,
      tags TEXT DEFAULT '[]',
      agent_id TEXT,
      locked_at INTEGER,
      context TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      completed_at INTEGER,
      deadline INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'functional',
      steps TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 5,
      depends_on TEXT DEFAULT '[]',
      agent_id TEXT,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      evidence TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      subtasks_attempted TEXT DEFAULT '[]',
      subtasks_completed TEXT DEFAULT '[]',
      progress_note TEXT DEFAULT '',
      git_commit TEXT,
      token_count INTEGER,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      label TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_status ON subtasks(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
  `)
}

const now = () => Math.floor(Date.now() / 1000)

const parseJson = <T>(s: string, fallback: T): T => {
  try { return JSON.parse(s) as T } catch { return fallback }
}

export const createSqliteAdapter = (dbPath: string): StorageAdapter => {
  let db: Database.Database

  return {
    connect: async () => {
      const dir = dirname(dbPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      initSchema(db)
      console.error('[DB] Connected to SQLite:', dbPath)
    },

    taskCreate: async (input) => {
      const id = generateId()
      const t = now()
      const context = JSON.stringify({ ...defaultContext, ...input.context })
      const tags = JSON.stringify(input.tags ?? [])
      const metadata = JSON.stringify(input.metadata ?? {})
      const deadline = input.deadline ? Math.floor(new Date(input.deadline).getTime() / 1000) : null
      db.prepare(`
        INSERT INTO tasks (id, title, description, status, phase, priority, tags, context, metadata, deadline, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', 'init', ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.title, input.description, input.priority ?? 5, tags, context, metadata, deadline, t, t)
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
      return rowToTask(row)
    },

    taskFindById: async (id) => {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? rowToTask(row) : null
    },

    taskList: async (filter) => {
      const conditions: string[] = []
      const params: unknown[] = []
      if (filter.status) { conditions.push('status = ?'); params.push(filter.status) }
      if (filter.phase) { conditions.push('phase = ?'); params.push(filter.phase) }
      if (filter.tags?.length) {
        conditions.push(`EXISTS (SELECT 1 FROM json_each(tags) WHERE value IN (${filter.tags.map(() => '?').join(',')}))`)
        params.push(...filter.tags)
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const countRow = db.prepare(`SELECT COUNT(*) as c FROM tasks ${where}`).get(...params) as { c: number }
      const rows = db.prepare(`
        SELECT * FROM tasks ${where}
        ORDER BY priority DESC, created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, filter.limit, filter.skip) as Record<string, unknown>[]
      return {
        tasks: rows.map(rowToTask),
        total: countRow.c,
      }
    },

    taskUpdate: async (id, input) => {
      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!existing) return null
      const updates: string[] = []
      const params: unknown[] = []
      const set = (col: string, val: unknown) => { updates.push(`${col} = ?`); params.push(val) }
      if (input.title !== undefined) set('title', input.title)
      if (input.description !== undefined) set('description', input.description)
      if (input.status !== undefined) set('status', input.status)
      if (input.phase !== undefined) set('phase', input.phase)
      if (input.priority !== undefined) set('priority', input.priority)
      if (input.tags !== undefined) set('tags', JSON.stringify(input.tags))
      if (input.context !== undefined) {
        const ctx = parseJson(existing.context as string, {}) as Record<string, unknown>
        set('context', JSON.stringify({ ...ctx, ...input.context }))
      }
      if (input.metadata !== undefined) set('metadata', JSON.stringify(input.metadata))
      if (input.deadline !== undefined) set('deadline', input.deadline ? Math.floor(new Date(input.deadline).getTime() / 1000) : null)
      if (updates.length === 0) return rowToTask(existing)
      set('updated_at', now())
      params.push(id)
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
      return rowToTask(updated)
    },

    taskDelete: async (id) => {
      db.prepare('DELETE FROM checkpoints WHERE task_id = ?').run(id)
      db.prepare('DELETE FROM sessions WHERE task_id = ?').run(id)
      db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(id)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    },

    taskLock: async (id, agentId) => {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!row) return null
      const currentAgent = row.agent_id as string | null
      if (currentAgent !== null && currentAgent !== agentId) return null
      const t = Math.floor(Date.now() / 1000)
      db.prepare('UPDATE tasks SET agent_id = ?, locked_at = ?, updated_at = ? WHERE id = ?').run(agentId, t, t, id)
      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
      return rowToTask(updated)
    },

    taskUnlock: async (id, agentId) => {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND agent_id = ?').get(id, agentId) as Record<string, unknown> | undefined
      if (!row) return null
      const t = now()
      db.prepare('UPDATE tasks SET agent_id = NULL, locked_at = NULL, updated_at = ? WHERE id = ?').run(t, id)
      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
      return rowToTask(updated)
    },

    subtaskCountByTask: async (taskId, status) => {
      let sql = 'SELECT COUNT(*) as c FROM subtasks WHERE task_id = ?'
      const params: unknown[] = [taskId]
      if (status !== undefined) {
        if (Array.isArray(status)) {
          sql += ` AND status IN (${status.map(() => '?').join(',')})`
          params.push(...status)
        } else {
          sql += ' AND status = ?'
          params.push(status)
        }
      }
      const row = db.prepare(sql).get(...params) as { c: number }
      return row.c
    },

    subtaskCreateBulk: async (taskId, items) => {
      const t = now()
      const stmt = db.prepare(`
        INSERT INTO subtasks (id, task_id, title, description, category, steps, priority, depends_on, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const created: Subtask[] = []
      for (const s of items) {
        const id = generateId()
        const dependsOn = JSON.stringify((s.dependsOn ?? []).map((d) => d))
        stmt.run(id, taskId, s.title, s.description, s.category ?? 'functional', JSON.stringify(s.steps ?? []), s.priority ?? 5, dependsOn, t, t)
        created.push({
          id,
          taskId,
          title: s.title,
          description: s.description,
          category: s.category ?? 'functional',
          steps: s.steps ?? [],
          status: 'pending',
          priority: s.priority ?? 5,
          dependsOn: s.dependsOn ?? [],
          agentId: null,
          attempts: 0,
          lastError: null,
          evidence: null,
          createdAt: new Date(t * 1000),
          updatedAt: new Date(t * 1000),
        })
      }
      return created
    },

    subtaskGetNext: async (taskId, agentId) => {
      const passed = db.prepare('SELECT id FROM subtasks WHERE task_id = ? AND status = ?').all(taskId, 'passed') as { id: string }[]
      const passedSet = new Set(passed.map((p) => p.id))
      const pending = db.prepare('SELECT * FROM subtasks WHERE task_id = ? AND status = ? ORDER BY priority DESC, created_at ASC').all(taskId, 'pending') as Record<string, unknown>[]
      for (const row of pending) {
        const deps = parseJson(row.depends_on as string, []) as string[]
        const allPassed = deps.every((d) => passedSet.has(d))
        if (!allPassed) continue
        const id = row.id as string
        const t = now()
        db.prepare('UPDATE subtasks SET status = ?, agent_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?').run('in_progress', agentId, t, id)
        return rowToSubtask({ ...row, status: 'in_progress', agent_id: agentId, attempts: ((row.attempts as number) ?? 0) + 1, updated_at: t })
      }
      return null
    },

    subtaskUpdateStatus: async (id, agentId, data) => {
      const row = db.prepare('SELECT * FROM subtasks WHERE id = ? AND agent_id = ?').get(id, agentId) as Record<string, unknown> | undefined
      if (!row) return null
      const updates: string[] = ['status = ?', 'updated_at = ?']
      const params: unknown[] = [data.status, now()]
      if (data.evidence !== undefined) { updates.push('evidence = ?'); params.push(data.evidence) }
      if (data.lastError !== undefined) { updates.push('last_error = ?'); params.push(data.lastError) }
      params.push(id)
      db.prepare(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      const updated = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Record<string, unknown>
      return rowToSubtask(updated)
    },

    sessionCreate: async (data) => {
      const id = generateId()
      const t = now()
      db.prepare(`
        INSERT INTO sessions (id, task_id, agent_id, phase, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.taskId, data.agentId, data.phase, t, t, t)
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>
      return rowToSession(row)
    },

    sessionFindLatestByTask: async (taskId, status) => {
      let sql = 'SELECT * FROM sessions WHERE task_id = ?'
      const params: unknown[] = [taskId]
      if (status) { sql += ' AND status = ?'; params.push(status) }
      sql += ' ORDER BY ended_at IS NULL, ended_at DESC, created_at DESC LIMIT 1'
      const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined
      return row ? rowToSession(row) : null
    },

    sessionUpdate: async (id, agentId, data) => {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND agent_id = ?').get(id, agentId) as Record<string, unknown> | undefined
      if (!row) return null
      const updates: string[] = ['progress_note = ?', 'updated_at = ?']
      const params: unknown[] = [data.progressNote ?? row.progress_note, now()]
      if (data.gitCommit !== undefined) { updates.push('git_commit = ?'); params.push(data.gitCommit) }
      if (data.tokenCount !== undefined) { updates.push('token_count = ?'); params.push(data.tokenCount) }
      if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status) }
      if (data.endedAt !== undefined) { updates.push('ended_at = ?'); params.push(Math.floor((data.endedAt as Date).getTime() / 1000)) }
      if (data.subtasksAttempted) { updates.push('subtasks_attempted = ?'); params.push(JSON.stringify(data.subtasksAttempted)) }
      if (data.subtasksCompleted) { updates.push('subtasks_completed = ?'); params.push(JSON.stringify(data.subtasksCompleted)) }
      params.push(id)
      db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>
      return rowToSession(updated)
    },

    checkpointCreate: async (data) => {
      const id = generateId()
      const t = now()
      db.prepare(`
        INSERT INTO checkpoints (id, task_id, session_id, label, snapshot, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.taskId, data.sessionId, data.label, JSON.stringify(data.snapshot), t, t)
      const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Record<string, unknown>
      return rowToCheckpoint(row)
    },

    checkpointFindByTaskAndLabel: async (taskId, label) => {
      const row = db.prepare('SELECT * FROM checkpoints WHERE task_id = ? AND label = ? ORDER BY created_at DESC LIMIT 1').get(taskId, label) as Record<string, unknown> | undefined
      return row ? rowToCheckpoint(row) : null
    },

    checkpointFindAllByTask: async (taskId) => {
      const rows = db.prepare('SELECT id, label, created_at, session_id FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[]
      return rows.map((r) => ({
        id: r.id as string,
        label: r.label as string,
        createdAt: new Date((r.created_at as number) * 1000),
        sessionId: r.session_id as string,
      }))
    },
  }
}

const rowToTask = (r: Record<string, unknown>): Task => {
  const ctx = parseJson(r.context as string, defaultContext) as Task['context']
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    status: r.status as Task['status'],
    phase: r.phase as Task['phase'],
    priority: r.priority as number,
    tags: parseJson(r.tags as string, []),
    agentId: r.agent_id as string | null,
    lockedAt: r.locked_at ? new Date((r.locked_at as number) * 1000) : null,
    context: ctx,
    metadata: parseJson(r.metadata as string, {}),
    completedAt: r.completed_at ? new Date((r.completed_at as number) * 1000) : null,
    deadline: r.deadline ? new Date((r.deadline as number) * 1000) : null,
    createdAt: new Date((r.created_at as number) * 1000),
    updatedAt: new Date((r.updated_at as number) * 1000),
  }
}

const rowToSubtask = (r: Record<string, unknown>): Subtask => ({
  id: r.id as string,
  taskId: r.task_id as string,
  title: r.title as string,
  description: r.description as string,
  category: r.category as Subtask['category'],
  steps: parseJson(r.steps as string, []),
  status: r.status as Subtask['status'],
  priority: r.priority as number,
  dependsOn: parseJson(r.depends_on as string, []),
  agentId: r.agent_id as string | null,
  attempts: r.attempts as number ?? 0,
  lastError: r.last_error as string | null,
  evidence: r.evidence as string | null,
  createdAt: new Date((r.created_at as number) * 1000),
  updatedAt: new Date((r.updated_at as number) * 1000),
})

const rowToSession = (r: Record<string, unknown>): Session => ({
  id: r.id as string,
  taskId: r.task_id as string,
  agentId: r.agent_id as string,
  phase: r.phase as Session['phase'],
  startedAt: new Date((r.started_at as number) * 1000),
  endedAt: r.ended_at ? new Date((r.ended_at as number) * 1000) : null,
  subtasksAttempted: parseJson(r.subtasks_attempted as string, []),
  subtasksCompleted: parseJson(r.subtasks_completed as string, []),
  progressNote: r.progress_note as string ?? '',
  gitCommit: r.git_commit as string | null,
  tokenCount: r.token_count as number | null,
  status: r.status as Session['status'],
  createdAt: new Date((r.created_at as number) * 1000),
  updatedAt: new Date((r.updated_at as number) * 1000),
})

const rowToCheckpoint = (r: Record<string, unknown>): Checkpoint => ({
  id: r.id as string,
  taskId: r.task_id as string,
  sessionId: r.session_id as string,
  label: r.label as string,
  snapshot: parseJson(r.snapshot as string, {}),
  createdAt: new Date((r.created_at as number) * 1000),
  updatedAt: new Date((r.updated_at as number) * 1000),
})
