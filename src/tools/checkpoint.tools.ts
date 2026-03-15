import { Tool } from '@modelcontextprotocol/sdk/types.js'
import mongoose from 'mongoose'
import { Checkpoint } from '../models/Checkpoint.js'
import { CheckpointSaveSchema, CheckpointRestoreSchema } from '../schemas/zod.schemas.js'

export const checkpointToolDefinitions: Tool[] = [
  {
    name: 'checkpoint_save',
    description:
      'Save a named snapshot of any state you want to persist. Use this before risky operations (large refactors, schema migrations, destructive changes) so you can roll back. The snapshot can contain any JSON-serializable data. Label it descriptively, e.g. "before-auth-refactor".',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        sessionId: { type: 'string' },
        label: { type: 'string', description: 'Descriptive name, e.g. "before-db-migration"' },
        snapshot: { type: 'object', description: 'Any JSON state you want to save' },
      },
      required: ['taskId', 'sessionId', 'label', 'snapshot'],
    },
  },
  {
    name: 'checkpoint_restore',
    description:
      'Restore the most recent checkpoint with a given label. Returns the snapshot data — it is your responsibility to apply it. Also returns a history of all checkpoints for this task so you can choose which one to restore.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        label: { type: 'string', description: 'The checkpoint label to restore' },
      },
      required: ['taskId', 'label'],
    },
  },
]

export const handleCheckpointTool = async (name: string, args: unknown): Promise<string> => {
  switch (name) {
    case 'checkpoint_save': {
      const { taskId, sessionId, label, snapshot } = CheckpointSaveSchema.parse(args)
      const checkpoint = await Checkpoint.create({
        taskId: new mongoose.Types.ObjectId(taskId),
        sessionId: new mongoose.Types.ObjectId(sessionId),
        label,
        snapshot,
      })
      return JSON.stringify({ success: true, checkpoint })
    }

    case 'checkpoint_restore': {
      const { taskId, label } = CheckpointRestoreSchema.parse(args)
      const taskOid = new mongoose.Types.ObjectId(taskId)

      const checkpoint = await Checkpoint.findOne({ taskId: taskOid, label })
        .sort({ createdAt: -1 })
        .lean()

      if (!checkpoint) return JSON.stringify({ success: false, error: `No checkpoint found with label "${label}"` })

      const allCheckpoints = await Checkpoint.find({ taskId: taskOid })
        .sort({ createdAt: -1 })
        .select('label createdAt sessionId')
        .lean()

      return JSON.stringify({ success: true, checkpoint, allCheckpoints })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown checkpoint tool: ${name}` })
  }
}
