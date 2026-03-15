import mongoose, { Document, Schema } from 'mongoose'

export type SessionStatus = 'active' | 'completed' | 'crashed' | 'timed_out'
export type SessionPhase = 'init' | 'execution'

export interface ISession extends Document {
  taskId: mongoose.Types.ObjectId
  agentId: string
  phase: SessionPhase
  startedAt: Date
  endedAt: Date | null
  subtasksAttempted: mongoose.Types.ObjectId[]
  subtasksCompleted: mongoose.Types.ObjectId[]
  progressNote: string
  gitCommit: string | null
  tokenCount: number | null
  status: SessionStatus
  createdAt: Date
  updatedAt: Date
}

const SessionSchema = new Schema<ISession>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    agentId: { type: String, required: true },
    phase: { type: String, enum: ['init', 'execution'], required: true },
    startedAt: { type: Date, default: () => new Date() },
    endedAt: { type: Date, default: null },
    subtasksAttempted: [{ type: Schema.Types.ObjectId, ref: 'Subtask' }],
    subtasksCompleted: [{ type: Schema.Types.ObjectId, ref: 'Subtask' }],
    progressNote: { type: String, default: '' },
    gitCommit: { type: String, default: null },
    tokenCount: { type: Number, default: null },
    status: {
      type: String,
      enum: ['active', 'completed', 'crashed', 'timed_out'],
      default: 'active',
    },
  },
  { timestamps: true }
)

SessionSchema.index({ taskId: 1, startedAt: -1 })
SessionSchema.index({ agentId: 1 })

export const Session = mongoose.model<ISession>('Session', SessionSchema)
