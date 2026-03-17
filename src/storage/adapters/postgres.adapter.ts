import pg from 'pg'
import { generateId } from '../types.js'
import type { StorageAdapter } from '../interface.js'
import type { Task, Subtask, Session, Checkpoint, TaskListFilter } from '../types.js'
import type { TaskCreateInput, TaskUpdateInput, SubtaskCreateItem } from '../interface.js'

const defaultContext = { workingDirectory: '/tmp', initScript: null, repoUrl: null, environmentVars: {} }

const initSchema = async (client: pg.PoolClient) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      phase TEXT DEFAULT 'init',
      priority INTEGER DEFAULT 5,
      tags JSONB DEFAULT '[]',
      agent_id TEXT,
      locked_at TIMESTAMPTZ,
      context JSONB DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      completed_at TIMESTAMPTZ,
      deadline TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'functional',
      steps JSONB DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 5,
      depends_on JSONB DEFAULT '[]',
      agent_id TEXT,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      evidence TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      subtasks_attempted JSONB DEFAULT '[]',
      subtasks_completed JSONB DEFAULT '[]',
      progress_note TEXT DEFAULT '',
      git_commit TEXT,
      token_count INTEGER,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      label TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_status ON subtasks(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
  `)
}

const toDate = (v: Date | string | null): Date | null =>
  v ? (v instanceof Date ? v : new Date(v)) : null

const rowToTask = (r: pg.QueryResultRow): Task => ({
  id: r.id as string,
  title: r.title as string,
  description: r.description as string,
  status: r.status as Task['status'],
  phase: r.phase as Task['phase'],
  priority: r.priority as number,
  tags: (r.tags as string[]) ?? [],
  agentId: r.agent_id as string | null,
  lockedAt: toDate(r.locked_at as Date | string | null),
  context: (r.context as Task['context']) ?? defaultContext,
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  completedAt: toDate(r.completed_at as Date | string | null),
  deadline: toDate(r.deadline as Date | string | null),
  createdAt: toDate(r.created_at as Date | string) as Date,
  updatedAt: toDate(r.updated_at as Date | string) as Date,
})

const rowToSubtask = (r: pg.QueryResultRow): Subtask => ({
  id: r.id as string,
  taskId: r.task_id as string,
  title: r.title as string,
  description: r.description as string,
  category: r.category as Subtask['category'],
  steps: (r.steps as string[]) ?? [],
  status: r.status as Subtask['status'],
  priority: r.priority as number,
  dependsOn: (r.depends_on as string[]) ?? [],
  agentId: r.agent_id as string | null,
  attempts: (r.attempts as number) ?? 0,
  lastError: r.last_error as string | null,
  evidence: r.evidence as string | null,
  createdAt: toDate(r.created_at as Date | string) as Date,
  updatedAt: toDate(r.updated_at as Date | string) as Date,
})

const rowToSession = (r: pg.QueryResultRow): Session => ({
  id: r.id as string,
  taskId: r.task_id as string,
  agentId: r.agent_id as string,
  phase: r.phase as Session['phase'],
  startedAt: toDate(r.started_at as Date | string) as Date,
  endedAt: toDate(r.ended_at as Date | string | null),
  subtasksAttempted: (r.subtasks_attempted as string[]) ?? [],
  subtasksCompleted: (r.subtasks_completed as string[]) ?? [],
  progressNote: (r.progress_note as string) ?? '',
  gitCommit: r.git_commit as string | null,
  tokenCount: r.token_count as number | null,
  status: r.status as Session['status'],
  createdAt: toDate(r.created_at as Date | string) as Date,
  updatedAt: toDate(r.updated_at as Date | string) as Date,
})

const rowToCheckpoint = (r: pg.QueryResultRow): Checkpoint => ({
  id: r.id as string,
  taskId: r.task_id as string,
  sessionId: r.session_id as string,
  label: r.label as string,
  snapshot: (r.snapshot as Record<string, unknown>) ?? {},
  createdAt: toDate(r.created_at as Date | string) as Date,
  updatedAt: toDate(r.updated_at as Date | string) as Date,
})

export const createPostgresAdapter = (connectionUrl: string): StorageAdapter => {
  const pool = new pg.Pool({ connectionString: connectionUrl })

  return {
    connect: async () => {
      const client = await pool.connect()
      try {
        await initSchema(client)
        console.error('[DB] Connected to PostgreSQL')
      } finally {
        client.release()
      }
    },

    taskCreate: async (input) => {
      const id = generateId()
      const now = new Date()
      const context = JSON.stringify({ ...defaultContext, ...input.context })
      const tags = JSON.stringify(input.tags ?? [])
      const metadata = JSON.stringify(input.metadata ?? {})
      const deadline = input.deadline ? new Date(input.deadline) : null
      await pool.query(
        `INSERT INTO tasks (id, title, description, status, phase, priority, tags, context, metadata, deadline, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', 'init', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $9)`,
        [id, input.title, input.description, input.priority ?? 5, tags, context, metadata, deadline, now]
      )
      const res = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      return rowToTask(res.rows[0])
    },

    taskFindById: async (id) => {
      const res = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      return res.rows[0] ? rowToTask(res.rows[0]) : null
    },

    taskList: async (filter) => {
      const conditions: string[] = []
      const params: unknown[] = []
      let i = 1
      if (filter.status) { conditions.push(`status = $${i++}`); params.push(filter.status) }
      if (filter.phase) { conditions.push(`phase = $${i++}`); params.push(filter.phase) }
      if (filter.tags?.length) {
        conditions.push(`tags ?| $${i}::text[]`)
        params.push(filter.tags)
        i++
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const countRes = await pool.query(`SELECT COUNT(*) as c FROM tasks ${where}`, params)
      const listParams = [...params, filter.limit, filter.skip]
      const res = await pool.query(
        `SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        listParams
      )
      return { tasks: res.rows.map(rowToTask), total: parseInt(countRes.rows[0].c, 10) }
    },

    taskUpdate: async (id, input) => {
      const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      if (existing.rows.length === 0) return null
      const updates: string[] = []
      const params: unknown[] = []
      let i = 1
      if (input.title !== undefined) { updates.push(`title = $${i++}`); params.push(input.title) }
      if (input.description !== undefined) { updates.push(`description = $${i++}`); params.push(input.description) }
      if (input.status !== undefined) { updates.push(`status = $${i++}`); params.push(input.status) }
      if (input.phase !== undefined) { updates.push(`phase = $${i++}`); params.push(input.phase) }
      if (input.priority !== undefined) { updates.push(`priority = $${i++}`); params.push(input.priority) }
      if (input.tags !== undefined) { updates.push(`tags = $${i++}::jsonb`); params.push(JSON.stringify(input.tags)) }
      if (input.context !== undefined) {
        const ctx = (existing.rows[0].context as Record<string, unknown>) ?? {}
        updates.push(`context = $${i++}::jsonb`)
        params.push(JSON.stringify({ ...ctx, ...input.context }))
      }
      if (input.metadata !== undefined) { updates.push(`metadata = $${i++}::jsonb`); params.push(JSON.stringify(input.metadata)) }
      if (input.deadline !== undefined) { updates.push(`deadline = $${i++}`); params.push(input.deadline ? new Date(input.deadline) : null) }
      if (updates.length === 0) return rowToTask(existing.rows[0])
      updates.push(`updated_at = $${i++}`)
      params.push(new Date(), id)
      await pool.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${i}`, params)
      const res = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      return rowToTask(res.rows[0])
    },

    taskDelete: async (id) => {
      await pool.query('DELETE FROM checkpoints WHERE task_id = $1', [id])
      await pool.query('DELETE FROM sessions WHERE task_id = $1', [id])
      await pool.query('DELETE FROM subtasks WHERE task_id = $1', [id])
      await pool.query('DELETE FROM tasks WHERE id = $1', [id])
    },

    taskLock: async (id, agentId) => {
      const res = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      if (res.rows.length === 0) return null
      const row = res.rows[0]
      const currentAgent = row.agent_id as string | null
      if (currentAgent !== null && currentAgent !== agentId) return null
      const now = new Date()
      await pool.query(
        'UPDATE tasks SET agent_id = $1, locked_at = $2, updated_at = $2 WHERE id = $3',
        [agentId, now, id]
      )
      const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      return rowToTask(updated.rows[0])
    },

    taskUnlock: async (id, agentId) => {
      const res = await pool.query('SELECT * FROM tasks WHERE id = $1 AND agent_id = $2', [id, agentId])
      if (res.rows.length === 0) return null
      const now = new Date()
      await pool.query('UPDATE tasks SET agent_id = NULL, locked_at = NULL, updated_at = $1 WHERE id = $2', [now, id])
      const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
      return rowToTask(updated.rows[0])
    },

    subtaskCountByTask: async (taskId, status) => {
      let sql = 'SELECT COUNT(*) as c FROM subtasks WHERE task_id = $1'
      const params: unknown[] = [taskId]
      if (status !== undefined) {
        if (Array.isArray(status)) {
          sql += ` AND status = ANY($2::text[])`
          params.push(status)
        } else {
          sql += ' AND status = $2'
          params.push(status)
        }
      }
      const res = await pool.query(sql, params)
      return parseInt(res.rows[0].c, 10)
    },

    subtaskCreateBulk: async (taskId, items) => {
      const now = new Date()
      const created: Subtask[] = []
      for (const s of items) {
        const id = generateId()
        const dependsOn = JSON.stringify((s.dependsOn ?? []).map((d) => d))
        const steps = JSON.stringify(s.steps ?? [])
        await pool.query(
          `INSERT INTO subtasks (id, task_id, title, description, category, steps, priority, depends_on, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $9)`,
          [id, taskId, s.title, s.description, s.category ?? 'functional', steps, s.priority ?? 5, dependsOn, now]
        )
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
          createdAt: now,
          updatedAt: now,
        })
      }
      return created
    },

    subtaskGetNext: async (taskId, agentId) => {
      const passedRes = await pool.query('SELECT id FROM subtasks WHERE task_id = $1 AND status = $2', [taskId, 'passed'])
      const passedSet = new Set(passedRes.rows.map((r) => r.id as string))
      const pendingRes = await pool.query(
        'SELECT * FROM subtasks WHERE task_id = $1 AND status = $2 ORDER BY priority DESC, created_at ASC',
        [taskId, 'pending']
      )
      for (const row of pendingRes.rows) {
        const deps = (row.depends_on as string[]) ?? []
        if (!deps.every((d) => passedSet.has(d))) continue
        const id = row.id as string
        const now = new Date()
        await pool.query(
          'UPDATE subtasks SET status = $1, agent_id = $2, attempts = attempts + 1, updated_at = $3 WHERE id = $4',
          ['in_progress', agentId, now, id]
        )
        const updated = await pool.query('SELECT * FROM subtasks WHERE id = $1', [id])
        return rowToSubtask(updated.rows[0])
      }
      return null
    },

    subtaskUpdateStatus: async (id, agentId, data) => {
      const res = await pool.query('SELECT * FROM subtasks WHERE id = $1 AND agent_id = $2', [id, agentId])
      if (res.rows.length === 0) return null
      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1
      updates.push(`status = $${idx++}`)
      params.push(data.status)
      if (data.evidence !== undefined) { updates.push(`evidence = $${idx++}`); params.push(data.evidence) }
      if (data.lastError !== undefined) { updates.push(`last_error = $${idx++}`); params.push(data.lastError) }
      updates.push(`updated_at = $${idx++}`)
      params.push(new Date(), id)
      await pool.query(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = $${idx}`, params)
      const updated = await pool.query('SELECT * FROM subtasks WHERE id = $1', [id])
      return rowToSubtask(updated.rows[0])
    },

    sessionCreate: async (data) => {
      const id = generateId()
      const now = new Date()
      await pool.query(
        `INSERT INTO sessions (id, task_id, agent_id, phase, started_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $5)`,
        [id, data.taskId, data.agentId, data.phase, now]
      )
      const res = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
      return rowToSession(res.rows[0])
    },

    sessionFindLatestByTask: async (taskId, status) => {
      let sql = 'SELECT * FROM sessions WHERE task_id = $1'
      const params: unknown[] = [taskId]
      if (status) { sql += ' AND status = $2'; params.push(status) }
      sql += ' ORDER BY ended_at DESC NULLS LAST, created_at DESC LIMIT 1'
      const res = await pool.query(sql, params)
      return res.rows[0] ? rowToSession(res.rows[0]) : null
    },

    sessionUpdate: async (id, agentId, data) => {
      const res = await pool.query('SELECT * FROM sessions WHERE id = $1 AND agent_id = $2', [id, agentId])
      if (res.rows.length === 0) return null
      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1
      updates.push(`progress_note = $${idx++}`)
      params.push(data.progressNote ?? res.rows[0].progress_note)
      updates.push(`updated_at = $${idx++}`)
      params.push(new Date())
      if (data.gitCommit !== undefined) { updates.push(`git_commit = $${idx++}`); params.push(data.gitCommit) }
      if (data.tokenCount !== undefined) { updates.push(`token_count = $${idx++}`); params.push(data.tokenCount) }
      if (data.status !== undefined) { updates.push(`status = $${idx++}`); params.push(data.status) }
      if (data.endedAt !== undefined) { updates.push(`ended_at = $${idx++}`); params.push(data.endedAt) }
      if (data.subtasksAttempted) { updates.push(`subtasks_attempted = $${idx++}::jsonb`); params.push(JSON.stringify(data.subtasksAttempted)) }
      if (data.subtasksCompleted) { updates.push(`subtasks_completed = $${idx++}::jsonb`); params.push(JSON.stringify(data.subtasksCompleted)) }
      params.push(id)
      await pool.query(`UPDATE sessions SET ${updates.join(', ')} WHERE id = $${idx}`, params)
      const updated = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
      return rowToSession(updated.rows[0])
    },

    checkpointCreate: async (data) => {
      const id = generateId()
      const now = new Date()
      await pool.query(
        `INSERT INTO checkpoints (id, task_id, session_id, label, snapshot, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)`,
        [id, data.taskId, data.sessionId, data.label, JSON.stringify(data.snapshot), now]
      )
      const res = await pool.query('SELECT * FROM checkpoints WHERE id = $1', [id])
      return rowToCheckpoint(res.rows[0])
    },

    checkpointFindByTaskAndLabel: async (taskId, label) => {
      const res = await pool.query(
        'SELECT * FROM checkpoints WHERE task_id = $1 AND label = $2 ORDER BY created_at DESC LIMIT 1',
        [taskId, label]
      )
      return res.rows[0] ? rowToCheckpoint(res.rows[0]) : null
    },

    checkpointFindAllByTask: async (taskId) => {
      const res = await pool.query(
        'SELECT id, label, created_at, session_id FROM checkpoints WHERE task_id = $1 ORDER BY created_at DESC',
        [taskId]
      )
      return res.rows.map((r) => ({
        id: r.id as string,
        label: r.label as string,
        createdAt: toDate(r.created_at as Date | string) as Date,
        sessionId: r.session_id as string,
      }))
    },
  }
}
