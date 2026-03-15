import { Tool } from '@modelcontextprotocol/sdk/types.js'
import mongoose from 'mongoose'
import { Task } from '../models/Task.js'
import { Subtask } from '../models/Subtask.js'
import { Session } from '../models/Session.js'
import { Checkpoint } from '../models/Checkpoint.js'
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
        id: { type: 'string', description: 'MongoDB ObjectId of the task' },
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

export const handleTaskTool = async (name: string, args: unknown): Promise<string> => {
  switch (name) {
    case 'task_create': {
      const input = TaskCreateSchema.parse(args)
      const task = await Task.create(input)
      return JSON.stringify({ success: true, task })
    }

    case 'task_get': {
      const { id } = TaskGetSchema.parse(args)
      const task = await Task.findById(id).lean()
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })

      const [total, passed, failed, pending, inProgress] = await Promise.all([
        Subtask.countDocuments({ taskId: id }),
        Subtask.countDocuments({ taskId: id, status: 'passed' }),
        Subtask.countDocuments({ taskId: id, status: 'failed' }),
        Subtask.countDocuments({ taskId: id, status: 'pending' }),
        Subtask.countDocuments({ taskId: id, status: 'in_progress' }),
      ])

      return JSON.stringify({ success: true, task, subtaskSummary: { total, passed, failed, pending, inProgress } })
    }

    case 'task_list': {
      const { status, phase, tags, limit, skip } = TaskListSchema.parse(args)
      const filter: Record<string, unknown> = {}
      if (status) filter.status = status
      if (phase) filter.phase = phase
      if (tags?.length) filter.tags = { $in: tags }

      const [tasks, total] = await Promise.all([
        Task.find(filter).sort({ priority: -1, createdAt: -1 }).limit(limit).skip(skip).lean(),
        Task.countDocuments(filter),
      ])

      return JSON.stringify({ success: true, tasks, total, limit, skip })
    }

    case 'task_update': {
      const { id, context, ...rest } = TaskUpdateSchema.parse(args)
      const updatePayload: Record<string, unknown> = { ...rest }

      if (context) {
        Object.entries(context).forEach(([k, v]) => {
          updatePayload[`context.${k}`] = v
        })
      }

      const task = await Task.findByIdAndUpdate(id, { $set: updatePayload }, { new: true }).lean()
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })
      return JSON.stringify({ success: true, task })
    }

    case 'task_delete': {
      const { id } = TaskDeleteSchema.parse(args)
      const oid = new mongoose.Types.ObjectId(id)
      await Promise.all([
        Task.findByIdAndDelete(id),
        Subtask.deleteMany({ taskId: oid }),
        Session.deleteMany({ taskId: oid }),
        Checkpoint.deleteMany({ taskId: oid }),
      ])
      return JSON.stringify({ success: true, message: 'Task and all related data deleted' })
    }

    case 'task_lock': {
      const { id, agentId } = TaskLockSchema.parse(args)
      const task = await Task.findOneAndUpdate(
        { _id: id, $or: [{ agentId: null }, { agentId: agentId }] },
        { $set: { agentId, lockedAt: new Date() } },
        { new: true }
      ).lean()
      if (!task) return JSON.stringify({ success: false, error: 'Task is already locked by another agent' })
      return JSON.stringify({ success: true, task })
    }

    case 'task_unlock': {
      const { id, agentId } = TaskUnlockSchema.parse(args)
      const task = await Task.findOneAndUpdate(
        { _id: id, agentId },
        { $set: { agentId: null, lockedAt: null } },
        { new: true }
      ).lean()
      if (!task) return JSON.stringify({ success: false, error: 'Task not found or not owned by this agent' })
      return JSON.stringify({ success: true, task })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown task tool: ${name}` })
  }
}
