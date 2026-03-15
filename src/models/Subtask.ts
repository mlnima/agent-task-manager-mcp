import mongoose, { Document, Schema } from 'mongoose'

export type SubtaskStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'blocked'
export type SubtaskCategory = 'functional' | 'ui' | 'performance' | 'security' | 'test'

export interface ISubtask extends Document {
  taskId: mongoose.Types.ObjectId
  title: string
  description: string
  category: SubtaskCategory
  steps: string[]
  status: SubtaskStatus
  priority: number
  dependsOn: mongoose.Types.ObjectId[]
  agentId: string | null
  attempts: number
  lastError: string | null
  evidence: string | null
  createdAt: Date
  updatedAt: Date
}

const SubtaskSchema = new Schema<ISubtask>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['functional', 'ui', 'performance', 'security', 'test'],
      default: 'functional',
    },
    steps: [{ type: String }],
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'passed', 'failed', 'blocked'],
      default: 'pending',
    },
    priority: { type: Number, default: 5, min: 1, max: 10 },
    dependsOn: [{ type: Schema.Types.ObjectId, ref: 'Subtask' }],
    agentId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    evidence: { type: String, default: null },
  },
  { timestamps: true }
)

SubtaskSchema.index({ taskId: 1, status: 1, priority: -1 })
SubtaskSchema.index({ taskId: 1, category: 1 })

export const Subtask = mongoose.model<ISubtask>('Subtask', SubtaskSchema)
