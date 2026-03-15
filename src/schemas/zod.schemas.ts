import { z } from 'zod'

export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId')

// ─── Task Schemas ────────────────────────────────────────────────────────────

export const TaskContextSchema = z.object({
  workingDirectory: z.string().default('/tmp'),
  initScript: z.string().nullable().default(null),
  repoUrl: z.string().nullable().default(null),
  environmentVars: z.record(z.string()).default({}),
})

export const TaskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().min(1).max(10).default(5),
  tags: z.array(z.string()).default([]),
  context: TaskContextSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  deadline: z.string().datetime().nullable().optional(),
})

export const TaskUpdateSchema = z.object({
  id: ObjectIdSchema,
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: z.enum(['pending', 'initializing', 'in_progress', 'paused', 'completed', 'failed']).optional(),
  phase: z.enum(['init', 'execution']).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  tags: z.array(z.string()).optional(),
  context: TaskContextSchema.partial().optional(),
  metadata: z.record(z.unknown()).optional(),
  deadline: z.string().datetime().nullable().optional(),
})

export const TaskGetSchema = z.object({
  id: ObjectIdSchema,
})

export const TaskListSchema = z.object({
  status: z.enum(['pending', 'initializing', 'in_progress', 'paused', 'completed', 'failed']).optional(),
  phase: z.enum(['init', 'execution']).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).default(0),
})

export const TaskDeleteSchema = z.object({
  id: ObjectIdSchema,
})

export const TaskLockSchema = z.object({
  id: ObjectIdSchema,
  agentId: z.string().min(1),
})

export const TaskUnlockSchema = z.object({
  id: ObjectIdSchema,
  agentId: z.string().min(1),
})

// ─── Subtask Schemas ─────────────────────────────────────────────────────────

export const SubtaskItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['functional', 'ui', 'performance', 'security', 'test']).default('functional'),
  steps: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(10).default(5),
  dependsOn: z.array(z.string()).default([]),
})

export const SubtaskCreateBulkSchema = z.object({
  taskId: ObjectIdSchema,
  subtasks: z.array(SubtaskItemSchema).min(1),
})

export const SubtaskGetNextSchema = z.object({
  taskId: ObjectIdSchema,
  agentId: z.string().min(1),
})

export const SubtaskUpdateStatusSchema = z.object({
  id: ObjectIdSchema,
  agentId: z.string().min(1),
  status: z.enum(['in_progress', 'passed', 'failed', 'blocked']),
  evidence: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
})

// ─── Session Schemas ──────────────────────────────────────────────────────────

export const SessionStartSchema = z.object({
  taskId: ObjectIdSchema,
  agentId: z.string().min(1),
  phase: z.enum(['init', 'execution']),
})

export const SessionEndSchema = z.object({
  id: ObjectIdSchema,
  agentId: z.string().min(1),
  progressNote: z.string().min(1),
  gitCommit: z.string().nullable().optional(),
  tokenCount: z.number().int().positive().optional(),
  status: z.enum(['completed', 'crashed', 'timed_out']).default('completed'),
  subtasksAttempted: z.array(ObjectIdSchema).default([]),
  subtasksCompleted: z.array(ObjectIdSchema).default([]),
})

// ─── Checkpoint Schemas ───────────────────────────────────────────────────────

export const CheckpointSaveSchema = z.object({
  taskId: ObjectIdSchema,
  sessionId: ObjectIdSchema,
  label: z.string().min(1),
  snapshot: z.record(z.unknown()),
})

export const CheckpointRestoreSchema = z.object({
  taskId: ObjectIdSchema,
  label: z.string().min(1),
})
