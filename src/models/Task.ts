import mongoose, { Document, Schema } from 'mongoose'

export type TaskStatus = 'pending' | 'initializing' | 'in_progress' | 'paused' | 'completed' | 'failed'
export type TaskPhase = 'init' | 'execution'

export interface ITaskContext {
  workingDirectory: string
  initScript: string | null
  repoUrl: string | null
  environmentVars: Record<string, string>
}

export interface ITask extends Document {
  title: string
  description: string
  status: TaskStatus
  phase: TaskPhase
  priority: number
  tags: string[]
  agentId: string | null
  lockedAt: Date | null
  context: ITaskContext
  metadata: Record<string, unknown>
  completedAt: Date | null
  deadline: Date | null
  createdAt: Date
  updatedAt: Date
}

const TaskContextSchema = new Schema<ITaskContext>(
  {
    workingDirectory: { type: String, required: true, default: '/tmp' },
    initScript: { type: String, default: null },
    repoUrl: { type: String, default: null },
    environmentVars: { type: Map, of: String, default: {} },
  },
  { _id: false }
)

const TaskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'initializing', 'in_progress', 'paused', 'completed', 'failed'],
      default: 'pending',
    },
    phase: { type: String, enum: ['init', 'execution'], default: 'init' },
    priority: { type: Number, default: 5, min: 1, max: 10 },
    tags: [{ type: String, trim: true }],
    agentId: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    context: { type: TaskContextSchema, default: () => ({}) },
    metadata: { type: Schema.Types.Mixed, default: {} },
    completedAt: { type: Date, default: null },
    deadline: { type: Date, default: null },
  },
  { timestamps: true }
)

TaskSchema.index({ status: 1, priority: -1 })
TaskSchema.index({ agentId: 1 })
TaskSchema.index({ tags: 1 })

export const Task = mongoose.model<ITask>('Task', TaskSchema)
