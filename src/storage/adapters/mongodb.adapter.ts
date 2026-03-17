import mongoose from 'mongoose'
import { Task as TaskModel } from '../../models/Task.js'
import { Subtask as SubtaskModel } from '../../models/Subtask.js'
import { Session as SessionModel } from '../../models/Session.js'
import { Checkpoint as CheckpointModel } from '../../models/Checkpoint.js'
import connectDB from '../../db.js'
import type { StorageAdapter } from '../interface.js'
import type { Task, Subtask, Session, Checkpoint, TaskListFilter } from '../types.js'
import type { TaskCreateInput, TaskUpdateInput, SubtaskCreateItem } from '../interface.js'

const toId = (oid: mongoose.Types.ObjectId | undefined): string => oid?.toString() ?? ''
const toOid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id)

const mapTask = (doc: unknown): Task => {
  const d = doc as Record<string, unknown>
  return {
    id: toId(d._id as mongoose.Types.ObjectId),
    title: d.title as string,
    description: d.description as string,
    status: d.status as Task['status'],
    phase: d.phase as Task['phase'],
    priority: d.priority as number,
    tags: (d.tags as string[]) ?? [],
    agentId: (d.agentId as string) ?? null,
    lockedAt: (d.lockedAt as Date) ?? null,
    context: (d.context as Task['context']) ?? { workingDirectory: '/tmp', initScript: null, repoUrl: null, environmentVars: {} },
    metadata: (d.metadata as Record<string, unknown>) ?? {},
    completedAt: (d.completedAt as Date) ?? null,
    deadline: (d.deadline as Date) ?? null,
    createdAt: d.createdAt as Date,
    updatedAt: d.updatedAt as Date,
  }
}

const mapSubtask = (doc: unknown): Subtask => {
  const d = doc as Record<string, unknown>
  return {
    id: toId(d._id as mongoose.Types.ObjectId),
    taskId: toId(d.taskId as mongoose.Types.ObjectId),
    title: d.title as string,
    description: d.description as string,
    category: d.category as Subtask['category'],
    steps: (d.steps as string[]) ?? [],
    status: d.status as Subtask['status'],
    priority: d.priority as number,
    dependsOn: ((d.dependsOn as mongoose.Types.ObjectId[]) ?? []).map(toId),
    agentId: (d.agentId as string) ?? null,
    attempts: (d.attempts as number) ?? 0,
    lastError: (d.lastError as string) ?? null,
    evidence: (d.evidence as string) ?? null,
    createdAt: d.createdAt as Date,
    updatedAt: d.updatedAt as Date,
  }
}

const mapSession = (doc: unknown): Session => {
  const d = doc as Record<string, unknown>
  return {
    id: toId(d._id as mongoose.Types.ObjectId),
    taskId: toId(d.taskId as mongoose.Types.ObjectId),
    agentId: d.agentId as string,
    phase: d.phase as Session['phase'],
    startedAt: d.startedAt as Date,
    endedAt: (d.endedAt as Date) ?? null,
    subtasksAttempted: ((d.subtasksAttempted as mongoose.Types.ObjectId[]) ?? []).map(toId),
    subtasksCompleted: ((d.subtasksCompleted as mongoose.Types.ObjectId[]) ?? []).map(toId),
    progressNote: (d.progressNote as string) ?? '',
    gitCommit: (d.gitCommit as string) ?? null,
    tokenCount: (d.tokenCount as number) ?? null,
    status: d.status as Session['status'],
    createdAt: d.createdAt as Date,
    updatedAt: d.updatedAt as Date,
  }
}

const mapCheckpoint = (doc: unknown): Checkpoint => {
  const d = doc as Record<string, unknown>
  return {
    id: toId(d._id as mongoose.Types.ObjectId),
    taskId: toId(d.taskId as mongoose.Types.ObjectId),
    sessionId: toId(d.sessionId as mongoose.Types.ObjectId),
    label: d.label as string,
    snapshot: d.snapshot as Record<string, unknown>,
    createdAt: d.createdAt as Date,
    updatedAt: d.updatedAt as Date,
  }
}

const defaultContext = { workingDirectory: '/tmp', initScript: null, repoUrl: null, environmentVars: {} }

export const createMongoAdapter = (): StorageAdapter => ({
  connect: connectDB,

  taskCreate: async (input) => {
    const task = await TaskModel.create({
      ...input,
      context: { ...defaultContext, ...input.context },
      deadline: input.deadline ? new Date(input.deadline) : null,
    })
    return mapTask(task.toObject())
  },

  taskFindById: async (id) => {
    const doc = await TaskModel.findById(id).lean()
    return doc ? mapTask(doc) : null
  },

  taskList: async (filter) => {
    const q: Record<string, unknown> = {}
    if (filter.status) q.status = filter.status
    if (filter.phase) q.phase = filter.phase
    if (filter.tags?.length) q.tags = { $in: filter.tags }
    const [tasks, total] = await Promise.all([
      TaskModel.find(q).sort({ priority: -1, createdAt: -1 }).limit(filter.limit).skip(filter.skip).lean(),
      TaskModel.countDocuments(q),
    ])
    return { tasks: tasks.map(mapTask), total }
  },

  taskUpdate: async (id, input) => {
    const update: Record<string, unknown> = { ...input }
    if (input.context) {
      Object.entries(input.context).forEach(([k, v]) => { update[`context.${k}`] = v })
    }
    if (input.deadline !== undefined) update.deadline = input.deadline ? new Date(input.deadline) : null
    const doc = await TaskModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean()
    return doc ? mapTask(doc) : null
  },

  taskDelete: async (id) => {
    const oid = toOid(id)
    await Promise.all([
      TaskModel.findByIdAndDelete(id),
      SubtaskModel.deleteMany({ taskId: oid }),
      SessionModel.deleteMany({ taskId: oid }),
      CheckpointModel.deleteMany({ taskId: oid }),
    ])
  },

  taskLock: async (id, agentId) => {
    const doc = await TaskModel.findOneAndUpdate(
      { _id: id, $or: [{ agentId: null }, { agentId }] },
      { $set: { agentId, lockedAt: new Date() } },
      { new: true }
    ).lean()
    return doc ? mapTask(doc) : null
  },

  taskUnlock: async (id, agentId) => {
    const doc = await TaskModel.findOneAndUpdate(
      { _id: id, agentId },
      { $set: { agentId: null, lockedAt: null } },
      { new: true }
    ).lean()
    return doc ? mapTask(doc) : null
  },

  subtaskCountByTask: async (taskId, status) => {
    const q: Record<string, unknown> = { taskId: toOid(taskId) }
    if (status !== undefined) {
      q.status = Array.isArray(status) ? { $in: status } : status
    }
    return SubtaskModel.countDocuments(q)
  },

  subtaskCreateBulk: async (taskId, items) => {
    const taskOid = toOid(taskId)
    const docs = items.map((s) => ({
      taskId: taskOid,
      title: s.title,
      description: s.description,
      category: s.category ?? 'functional',
      steps: s.steps ?? [],
      priority: s.priority ?? 5,
      dependsOn: (s.dependsOn ?? []).map(toOid),
    }))
    const created = await SubtaskModel.insertMany(docs)
    return created.map((c) => mapSubtask(c.toObject()))
  },

  subtaskGetNext: async (taskId, agentId) => {
    const taskOid = toOid(taskId)
    const passedIds = await SubtaskModel.find({ taskId: taskOid, status: 'passed' }).distinct('_id')
    const doc = await SubtaskModel.findOneAndUpdate(
      {
        taskId: taskOid,
        status: 'pending',
        $or: [{ dependsOn: { $size: 0 } }, { dependsOn: { $not: { $elemMatch: { $nin: passedIds } } } }],
      },
      { $set: { status: 'in_progress', agentId }, $inc: { attempts: 1 } },
      { new: true, sort: { priority: -1, createdAt: 1 } }
    ).lean()
    return doc ? mapSubtask(doc) : null
  },

  subtaskUpdateStatus: async (id, agentId, data) => {
    const doc = await SubtaskModel.findOneAndUpdate(
      { _id: id, agentId },
      { $set: data },
      { new: true }
    ).lean()
    return doc ? mapSubtask(doc) : null
  },

  sessionCreate: async (data) => {
    const session = await SessionModel.create({
      taskId: toOid(data.taskId),
      agentId: data.agentId,
      phase: data.phase,
    })
    return mapSession(session.toObject())
  },

  sessionFindLatestByTask: async (taskId, status) => {
    const q: Record<string, unknown> = { taskId: toOid(taskId) }
    if (status) q.status = status
    const doc = await SessionModel.findOne(q).sort({ endedAt: -1 }).lean()
    return doc ? mapSession(doc) : null
  },

  sessionUpdate: async (id, agentId, data) => {
    const update: Record<string, unknown> = { ...data }
    if (data.subtasksAttempted) update.subtasksAttempted = data.subtasksAttempted.map(toOid)
    if (data.subtasksCompleted) update.subtasksCompleted = data.subtasksCompleted.map(toOid)
    if (data.endedAt !== undefined) update.endedAt = data.endedAt
    const doc = await SessionModel.findOneAndUpdate(
      { _id: id, agentId },
      { $set: update },
      { new: true }
    ).lean()
    return doc ? mapSession(doc) : null
  },

  checkpointCreate: async (data) => {
    const cp = await CheckpointModel.create({
      taskId: toOid(data.taskId),
      sessionId: toOid(data.sessionId),
      label: data.label,
      snapshot: data.snapshot,
    })
    return mapCheckpoint(cp.toObject())
  },

  checkpointFindByTaskAndLabel: async (taskId, label) => {
    const doc = await CheckpointModel.findOne({ taskId: toOid(taskId), label })
      .sort({ createdAt: -1 })
      .lean()
    return doc ? mapCheckpoint(doc) : null
  },

  checkpointFindAllByTask: async (taskId) => {
    const docs = await CheckpointModel.find({ taskId: toOid(taskId) })
      .sort({ createdAt: -1 })
      .select('label createdAt sessionId')
      .lean()
    return docs.map((d) => ({
      id: toId(d._id),
      label: d.label,
      createdAt: d.createdAt,
      sessionId: toId(d.sessionId),
    }))
  },
})
