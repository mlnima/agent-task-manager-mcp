import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getRouter, toAgentJSON } from '../storage/index.js'
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

const normalize = <T>(obj: T): T => JSON.parse(toAgentJSON(obj)) as T

export const handleCheckpointTool = async (name: string, args: unknown): Promise<string> => {
  const adapter = getRouter().getAdapter()

  switch (name) {
    case 'checkpoint_save': {
      const { taskId, sessionId, label, snapshot } = CheckpointSaveSchema.parse(args)
      const checkpoint = await adapter.checkpointCreate({ taskId, sessionId, label, snapshot })
      return JSON.stringify({ success: true, checkpoint: normalize(checkpoint) })
    }

    case 'checkpoint_restore': {
      const { taskId, label } = CheckpointRestoreSchema.parse(args)

      const checkpoint = await adapter.checkpointFindByTaskAndLabel(taskId, label)
      if (!checkpoint) return JSON.stringify({ success: false, error: `No checkpoint found with label "${label}"` })

      const allCheckpoints = await adapter.checkpointFindAllByTask(taskId)

      return JSON.stringify({ success: true, checkpoint: normalize(checkpoint), allCheckpoints: allCheckpoints.map(normalize) })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown checkpoint tool: ${name}` })
  }
}
