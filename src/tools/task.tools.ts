import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getRouter, toAgentJSON } from '../storage/index.js'
import {
  TaskCreateSchema,
  TaskUpdateSchema,
  TaskGetSchema,
  TaskListSchema,
  TaskDeleteSchema,
  TaskLockSchema,
  TaskUnlockSchema,
} from '../schemas/zod.schemas.js'

export const taskToolDefinitions: Tool[] = [
  {
    name: 'task_create',
    description:
      'Create a new top-level task. Use this at the start of any large job that will span multiple agent sessions. Returns the created task with its ID — save this ID, you will need it for all subsequent operations.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title' },
        description: { type: 'string', description: 'Full specification of what needs to be accomplished' },
        priority: { type: 'number', description: '1 (lowest) to 10 (highest). Default 5.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'e.g. ["web", "fullstack"]' },
        context: {
          type: 'object',
          properties: {
            workingDirectory: { type: 'string' },
            initScript: { type: 'string' },
            repoUrl: { type: 'string' },
            environmentVars: { type: 'object' },
          },
        },
        metadata: { type: 'object', description: 'Any extra data you want to persist with this task' },
        deadline: { type: 'string', description: 'ISO 8601 datetime string, optional' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'task_get',
    description:
      'Get a task by ID, including a summary of its subtask progress (total, passed, failed, pending). Use this to understand the current state of work before starting a session.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_list',
    description:
      'List tasks with optional filters. Use this to find tasks that need work, are in progress, or match specific tags.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'initializing', 'in_progress', 'paused', 'completed', 'failed'],
        },
        phase: { type: 'string', enum: ['init', 'execution'] },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max results. Default 20, max 100.' },
        skip: { type: 'number', description: 'Pagination offset. Default 0.' },
      },
    },
  },
  {
    name: 'task_update',
    description:
      'Update task fields. Use to change status, phase, priority, context, or store arbitrary metadata. Only provided fields are updated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'initializing', 'in_progress', 'paused', 'completed', 'failed'] },
        phase: { type: 'string', enum: ['init', 'execution'] },
        priority: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        context: { type: 'object' },
        metadata: { type: 'object' },
        deadline: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_delete',
    description:
      'Permanently delete a task and ALL related subtasks, sessions, and checkpoints. This cannot be undone. Only call this when you are certain the task is no longer needed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_lock',
    description:
      'Claim exclusive ownership of a task for your agentId. Prevents other agents from picking up the same task. Always lock a task before starting work. Will fail if the task is already locked by a different agent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        agentId: { type: 'string', description: 'A unique identifier for this agent instance' },
      },
      required: ['id', 'agentId'],
    },
  },
  {
    name: 'task_unlock',
    description:
      'Release ownership of a task. Call this at the end of a session or when handing off to another agent. Only the agent that locked the task can unlock it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        agentId: { type: 'string' },
      },
      required: ['id', 'agentId'],
    },
  },
]

const normalize = <T>(obj: T): T => JSON.parse(toAgentJSON(obj)) as T

export const handleTaskTool = async (name: string, args: unknown): Promise<string> => {
  const adapter = getRouter().getAdapter()

  switch (name) {
    case 'task_create': {
      const input = TaskCreateSchema.parse(args)
      const task = await adapter.taskCreate(input)
      return JSON.stringify({ success: true, task: normalize(task) })
    }

    case 'task_get': {
      const { id } = TaskGetSchema.parse(args)
      const task = await adapter.taskFindById(id)
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })

      const [total, passed, failed, pending, inProgress] = await Promise.all([
        adapter.subtaskCountByTask(id),
        adapter.subtaskCountByTask(id, 'passed'),
        adapter.subtaskCountByTask(id, 'failed'),
        adapter.subtaskCountByTask(id, 'pending'),
        adapter.subtaskCountByTask(id, 'in_progress'),
      ])

      return JSON.stringify({ success: true, task: normalize(task), subtaskSummary: { total, passed, failed, pending, inProgress } })
    }

    case 'task_list': {
      const { status, phase, tags, limit, skip } = TaskListSchema.parse(args)
      const { tasks, total } = await adapter.taskList({ status, phase, tags, limit, skip })
      return JSON.stringify({ success: true, tasks: tasks.map(normalize), total, limit, skip })
    }

    case 'task_update': {
      const { id, ...rest } = TaskUpdateSchema.parse(args)
      const task = await adapter.taskUpdate(id, rest)
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })
      return JSON.stringify({ success: true, task: normalize(task) })
    }

    case 'task_delete': {
      const { id } = TaskDeleteSchema.parse(args)
      await adapter.taskDelete(id)
      return JSON.stringify({ success: true, message: 'Task and all related data deleted' })
    }

    case 'task_lock': {
      const { id, agentId } = TaskLockSchema.parse(args)
      const task = await adapter.taskLock(id, agentId)
      if (!task) return JSON.stringify({ success: false, error: 'Task is already locked by another agent' })
      return JSON.stringify({ success: true, task: normalize(task) })
    }

    case 'task_unlock': {
      const { id, agentId } = TaskUnlockSchema.parse(args)
      const task = await adapter.taskUnlock(id, agentId)
      if (!task) return JSON.stringify({ success: false, error: 'Task not found or not owned by this agent' })
      return JSON.stringify({ success: true, task: normalize(task) })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown task tool: ${name}` })
  }
}
