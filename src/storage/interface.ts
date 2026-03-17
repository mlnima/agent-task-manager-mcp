import type { Task, Subtask, Session, Checkpoint, TaskListFilter } from './types.js'

export interface TaskCreateInput {
  title: string
  description: string
  priority?: number
  tags?: string[]
  context?: Partial<{ workingDirectory: string; initScript: string | null; repoUrl: string | null; environmentVars: Record<string, string> }>
  metadata?: Record<string, unknown>
  deadline?: string | null
}

export interface TaskUpdateInput {
  title?: string
  description?: string
  status?: Task['status']
  phase?: Task['phase']
  priority?: number
  tags?: string[]
  context?: Partial<Task['context']>
  metadata?: Record<string, unknown>
  deadline?: string | null
}

export interface SubtaskCreateItem {
  title: string
  description: string
  category?: Subtask['category']
  steps?: string[]
  priority?: number
  dependsOn?: string[]
}

/** Adapter interface for storage backends (MongoDB, Postgres, SQLite, JSON). */
export interface StorageAdapter {
  connect(): Promise<void>

  taskCreate(input: TaskCreateInput): Promise<Task>
  taskFindById(id: string): Promise<Task | null>
  taskList(filter: TaskListFilter): Promise<{ tasks: Task[]; total: number }>
  taskUpdate(id: string, input: TaskUpdateInput): Promise<Task | null>
  taskDelete(id: string): Promise<void>
  taskLock(id: string, agentId: string): Promise<Task | null>
  taskUnlock(id: string, agentId: string): Promise<Task | null>

  subtaskCountByTask(taskId: string, status?: Subtask['status'] | Subtask['status'][]): Promise<number>
  subtaskCreateBulk(taskId: string, items: SubtaskCreateItem[]): Promise<Subtask[]>
  subtaskGetNext(taskId: string, agentId: string): Promise<Subtask | null>
  subtaskUpdateStatus(id: string, agentId: string, data: { status: Subtask['status']; evidence?: string | null; lastError?: string | null }): Promise<Subtask | null>

  sessionCreate(data: { taskId: string; agentId: string; phase: Session['phase'] }): Promise<Session>
  sessionFindLatestByTask(taskId: string, status?: Session['status']): Promise<Session | null>
  sessionUpdate(id: string, agentId: string, data: Partial<Pick<Session, 'progressNote' | 'gitCommit' | 'tokenCount' | 'status' | 'endedAt' | 'subtasksAttempted' | 'subtasksCompleted'>>): Promise<Session | null>

  checkpointCreate(data: { taskId: string; sessionId: string; label: string; snapshot: Record<string, unknown> }): Promise<Checkpoint>
  checkpointFindByTaskAndLabel(taskId: string, label: string): Promise<Checkpoint | null>
  checkpointFindAllByTask(taskId: string): Promise<Pick<Checkpoint, 'id' | 'label' | 'createdAt' | 'sessionId'>[]>
}
