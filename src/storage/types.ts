import { randomBytes } from 'node:crypto'

export type TaskStatus = 'pending' | 'initializing' | 'in_progress' | 'paused' | 'completed' | 'failed'
export type TaskPhase = 'init' | 'execution'
export type SubtaskStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'blocked'
export type SubtaskCategory = 'functional' | 'ui' | 'performance' | 'security' | 'test'
export type SessionStatus = 'active' | 'completed' | 'crashed' | 'timed_out'
export type SessionPhase = 'init' | 'execution'

export interface TaskContext {
  workingDirectory: string
  initScript: string | null
  repoUrl: string | null
  environmentVars: Record<string, string>
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  phase: TaskPhase
  priority: number
  tags: string[]
  agentId: string | null
  lockedAt: Date | null
  context: TaskContext
  metadata: Record<string, unknown>
  completedAt: Date | null
  deadline: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Subtask {
  id: string
  taskId: string
  title: string
  description: string
  category: SubtaskCategory
  steps: string[]
  status: SubtaskStatus
  priority: number
  dependsOn: string[]
  agentId: string | null
  attempts: number
  lastError: string | null
  evidence: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Session {
  id: string
  taskId: string
  agentId: string
  phase: SessionPhase
  startedAt: Date
  endedAt: Date | null
  subtasksAttempted: string[]
  subtasksCompleted: string[]
  progressNote: string
  gitCommit: string | null
  tokenCount: number | null
  status: SessionStatus
  createdAt: Date
  updatedAt: Date
}

export interface Checkpoint {
  id: string
  taskId: string
  sessionId: string
  label: string
  snapshot: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface TaskListFilter {
  status?: TaskStatus
  phase?: TaskPhase
  tags?: string[]
  limit: number
  skip: number
}

export const generateId = (): string => randomBytes(12).toString('hex')
