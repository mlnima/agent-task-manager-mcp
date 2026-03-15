import mongoose, { Document, Schema } from 'mongoose'

export interface ICheckpoint extends Document {
  taskId: mongoose.Types.ObjectId
  sessionId: mongoose.Types.ObjectId
  label: string
  snapshot: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const CheckpointSchema = new Schema<ICheckpoint>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    label: { type: String, required: true, trim: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
)

CheckpointSchema.index({ taskId: 1, label: 1 })
CheckpointSchema.index({ taskId: 1, createdAt: -1 })

export const Checkpoint = mongoose.model<ICheckpoint>('Checkpoint', CheckpointSchema)
