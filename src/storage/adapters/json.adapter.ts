import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateId } from '../types.js'
import type { StorageAdapter } from '../interface.js'
import type { Task, Subtask, Session, Checkpoint } from '../types.js'

const defaultContext = { workingDirectory: '/tmp', initScript: null, repoUrl: null, environmentVars: {} }

type JsonStore = {
  tasks: Task[]
  subtasks: Subtask[]
  sessions: Session[]
  checkpoints: Checkpoint[]
}

const emptyStore = (): JsonStore => ({
  tasks: [],
  subtasks: [],
  sessions: [],
  checkpoints: [],
})

export const createJsonAdapter = (filePath: string): StorageAdapter => {
  const reviveDates = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(reviveDates)
    if (obj instanceof Date) return obj
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) out[k] = new Date(v)
      else out[k] = reviveDates(v)
    }
    return out
  }

  const load = (): JsonStore => {
    if (!existsSync(filePath)) return emptyStore()
    const raw = readFileSync(filePath, 'utf-8')
    try {
      const data = JSON.parse(raw) as JsonStore
      return {
        tasks: (data.tasks ?? []).map((t) => reviveDates(t) as Task),
        subtasks: (data.subtasks ?? []).map((s) => reviveDates(s) as Subtask),
        sessions: (data.sessions ?? []).map((s) => reviveDates(s) as Session),
        checkpoints: (data.checkpoints ?? []).map((c) => reviveDates(c) as Checkpoint),
      }
    } catch {
      return emptyStore()
    }
  }

  const save = (store: JsonStore) => {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  return {
    connect: async () => {
      const dir = dirname(filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      if (!existsSync(filePath)) save(emptyStore())
      console.error('[DB] Connected to JSON file:', filePath)
    },

    taskCreate: async (input) => {
      const store = load()
      const id = generateId()
      const now = new Date()
      const task: Task = {
        id,
        title: input.title,
        description: input.description,
        status: 'pending',
        phase: 'init',
        priority: input.priority ?? 5,
        tags: input.tags ?? [],
        agentId: null,
        lockedAt: null,
        context: { ...defaultContext, ...input.context },
        metadata: input.metadata ?? {},
        completedAt: null,
        deadline: input.deadline ? new Date(input.deadline) : null,
        createdAt: now,
        updatedAt: now,
      }
      store.tasks.push(task)
      save(store)
      return task
    },

    taskFindById: async (id) => {
      const store = load()
      return store.tasks.find((t) => t.id === id) ?? null
    },

    taskList: async (filter) => {
      const store = load()
      let list = store.tasks
      if (filter.status) list = list.filter((t) => t.status === filter.status)
      if (filter.phase) list = list.filter((t) => t.phase === filter.phase)
      if (filter.tags?.length) list = list.filter((t) => filter.tags!.some((tag) => t.tags.includes(tag)))
      const total = list.length
      list = list.sort((a, b) => b.priority - a.priority || b.createdAt.getTime() - a.createdAt.getTime())
      list = list.slice(filter.skip, filter.skip + filter.limit)
      return { tasks: list, total }
    },

    taskUpdate: async (id, input) => {
      const store = load()
      const idx = store.tasks.findIndex((t) => t.id === id)
      if (idx < 0) return null
      const t = store.tasks[idx]
      if (input.title !== undefined) t.title = input.title
      if (input.description !== undefined) t.description = input.description
      if (input.status !== undefined) t.status = input.status
      if (input.phase !== undefined) t.phase = input.phase
      if (input.priority !== undefined) t.priority = input.priority
      if (input.tags !== undefined) t.tags = input.tags
      if (input.context !== undefined) t.context = { ...t.context, ...input.context }
      if (input.metadata !== undefined) t.metadata = input.metadata
      if (input.deadline !== undefined) t.deadline = input.deadline ? new Date(input.deadline) : null
      t.updatedAt = new Date()
      save(store)
      return t
    },

    taskDelete: async (id) => {
      const store = load()
      store.tasks = store.tasks.filter((t) => t.id !== id)
      store.subtasks = store.subtasks.filter((s) => s.taskId !== id)
      store.sessions = store.sessions.filter((s) => s.taskId !== id)
      store.checkpoints = store.checkpoints.filter((c) => c.taskId !== id)
      save(store)
    },

    taskLock: async (id, agentId) => {
      const store = load()
      const t = store.tasks.find((x) => x.id === id)
      if (!t) return null
      if (t.agentId !== null && t.agentId !== agentId) return null
      t.agentId = agentId
      t.lockedAt = new Date()
      t.updatedAt = new Date()
      save(store)
      return t
    },

    taskUnlock: async (id, agentId) => {
      const store = load()
      const t = store.tasks.find((x) => x.id === id && x.agentId === agentId)
      if (!t) return null
      t.agentId = null
      t.lockedAt = null
      t.updatedAt = new Date()
      save(store)
      return t
    },

    subtaskCountByTask: async (taskId, status) => {
      const store = load()
      let list = store.subtasks.filter((s) => s.taskId === taskId)
      if (status !== undefined) {
        list = Array.isArray(status) ? list.filter((s) => status.includes(s.status)) : list.filter((s) => s.status === status)
      }
      return list.length
    },

    subtaskCreateBulk: async (taskId, items) => {
      const store = load()
      const now = new Date()
      const created: Subtask[] = items.map((s) => ({
        id: generateId(),
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
      }))
      store.subtasks.push(...created)
      save(store)
      return created
    },

    subtaskGetNext: async (taskId, agentId) => {
      const store = load()
      const passed = new Set(store.subtasks.filter((s) => s.taskId === taskId && s.status === 'passed').map((s) => s.id))
      const pending = store.subtasks
        .filter((s) => s.taskId === taskId && s.status === 'pending')
        .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
      for (const s of pending) {
        if (!s.dependsOn.every((d) => passed.has(d))) continue
        s.status = 'in_progress'
        s.agentId = agentId
        s.attempts += 1
        s.updatedAt = new Date()
        save(store)
        return s
      }
      return null
    },

    subtaskUpdateStatus: async (id, agentId, data) => {
      const store = load()
      const s = store.subtasks.find((x) => x.id === id && x.agentId === agentId)
      if (!s) return null
      s.status = data.status
      if (data.evidence !== undefined) s.evidence = data.evidence
      if (data.lastError !== undefined) s.lastError = data.lastError
      s.updatedAt = new Date()
      save(store)
      return s
    },

    sessionCreate: async (data) => {
      const store = load()
      const now = new Date()
      const session: Session = {
        id: generateId(),
        taskId: data.taskId,
        agentId: data.agentId,
        phase: data.phase,
        startedAt: now,
        endedAt: null,
        subtasksAttempted: [],
        subtasksCompleted: [],
        progressNote: '',
        gitCommit: null,
        tokenCount: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      store.sessions.push(session)
      save(store)
      return session
    },

    sessionFindLatestByTask: async (taskId, status) => {
      const store = load()
      let list = store.sessions.filter((s) => s.taskId === taskId)
      if (status) list = list.filter((s) => s.status === status)
      return list.sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))[0] ?? null
    },

    sessionUpdate: async (id, agentId, data) => {
      const store = load()
      const s = store.sessions.find((x) => x.id === id && x.agentId === agentId)
      if (!s) return null
      if (data.progressNote !== undefined) s.progressNote = data.progressNote
      if (data.gitCommit !== undefined) s.gitCommit = data.gitCommit
      if (data.tokenCount !== undefined) s.tokenCount = data.tokenCount
      if (data.status !== undefined) s.status = data.status
      if (data.endedAt !== undefined) s.endedAt = data.endedAt
      if (data.subtasksAttempted) s.subtasksAttempted = data.subtasksAttempted
      if (data.subtasksCompleted) s.subtasksCompleted = data.subtasksCompleted
      s.updatedAt = new Date()
      save(store)
      return s
    },

    checkpointCreate: async (data) => {
      const store = load()
      const now = new Date()
      const cp: Checkpoint = {
        id: generateId(),
        taskId: data.taskId,
        sessionId: data.sessionId,
        label: data.label,
        snapshot: data.snapshot,
        createdAt: now,
        updatedAt: now,
      }
      store.checkpoints.push(cp)
      save(store)
      return cp
    },

    checkpointFindByTaskAndLabel: async (taskId, label) => {
      const store = load()
      const list = store.checkpoints.filter((c) => c.taskId === taskId && c.label === label)
      return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    },

    checkpointFindAllByTask: async (taskId) => {
      const store = load()
      return store.checkpoints
        .filter((c) => c.taskId === taskId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, sessionId: c.sessionId }))
    },
  }
}
