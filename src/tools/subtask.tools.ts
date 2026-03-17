import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getRouter, toAgentJSON } from '../storage/index.js'
import {
  SubtaskCreateBulkSchema,
  SubtaskGetNextSchema,
  SubtaskUpdateStatusSchema,
} from '../schemas/zod.schemas.js'

export const subtaskToolDefinitions: Tool[] = [
  {
    name: 'subtask_create_bulk',
    description:
      'Create the full feature/subtask list for a task in one shot. Call this once during the init phase after you have analyzed the full specification. Each subtask represents one atomic unit of work. Set dependsOn to enforce ordering. Returns all created subtask IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        subtasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              category: { type: 'string', enum: ['functional', 'ui', 'performance', 'security', 'test'] },
              steps: { type: 'array', items: { type: 'string' }, description: 'Verification steps — what done looks like' },
              priority: { type: 'number' },
              dependsOn: { type: 'array', items: { type: 'string' }, description: 'Subtask IDs that must pass before this one can start' },
            },
            required: ['title', 'description'],
          },
          minItems: 1,
        },
      },
      required: ['taskId', 'subtasks'],
    },
  },
  {
    name: 'subtask_get_next',
    description:
      'Get the next subtask to work on. Returns the highest-priority pending subtask whose dependencies have all passed. Claims the subtask for your agentId atomically. Returns null if all subtasks are done or blocked. ALWAYS call this instead of choosing a subtask yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' },
      },
      required: ['taskId', 'agentId'],
    },
  },
  {
    name: 'subtask_update_status',
    description:
      'Update the status of a subtask after attempting it. You MUST provide evidence of how you verified the result before marking it as passed. If failed, provide lastError so the next agent knows what went wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        agentId: { type: 'string' },
        status: { type: 'string', enum: ['in_progress', 'passed', 'failed', 'blocked'] },
        evidence: {
          type: 'string',
          description: 'Required when marking passed. Describe exactly how you verified this — e.g. "curl output showed 200", "Puppeteer screenshot confirms button renders"',
        },
        lastError: { type: 'string', description: 'Required when marking failed or blocked. What went wrong.' },
      },
      required: ['id', 'agentId', 'status'],
    },
  },
]

const normalize = <T>(obj: T): T => JSON.parse(toAgentJSON(obj)) as T

export const handleSubtaskTool = async (name: string, args: unknown): Promise<string> => {
  const adapter = getRouter().getAdapter()

  switch (name) {
    case 'subtask_create_bulk': {
      const { taskId, subtasks } = SubtaskCreateBulkSchema.parse(args)
      const created = await adapter.subtaskCreateBulk(taskId, subtasks)
      return JSON.stringify({
        success: true,
        count: created.length,
        subtasks: created.map((s) => ({ id: s.id, title: s.title, priority: s.priority })),
      })
    }

    case 'subtask_get_next': {
      const { taskId, agentId } = SubtaskGetNextSchema.parse(args)
      const next = await adapter.subtaskGetNext(taskId, agentId)
      if (!next) return JSON.stringify({ success: true, subtask: null, message: 'No pending subtasks available' })
      return JSON.stringify({ success: true, subtask: normalize(next) })
    }

    case 'subtask_update_status': {
      const { id, agentId, status, evidence, lastError } = SubtaskUpdateStatusSchema.parse(args)

      if (status === 'passed' && !evidence) {
        return JSON.stringify({ success: false, error: 'evidence is required when marking a subtask as passed' })
      }
      if ((status === 'failed' || status === 'blocked') && !lastError) {
        return JSON.stringify({ success: false, error: 'lastError is required when marking a subtask as failed or blocked' })
      }

      const subtask = await adapter.subtaskUpdateStatus(id, agentId, { status, evidence, lastError })
      if (!subtask) return JSON.stringify({ success: false, error: 'Subtask not found or not owned by this agent' })
      return JSON.stringify({ success: true, subtask: normalize(subtask) })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown subtask tool: ${name}` })
  }
}
