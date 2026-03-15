import { Tool } from '@modelcontextprotocol/sdk/types.js'
import mongoose from 'mongoose'
import { Session } from '../models/Session.js'
import { Task } from '../models/Task.js'
import { Subtask } from '../models/Subtask.js'
import { SessionStartSchema, SessionEndSchema } from '../schemas/zod.schemas.js'

export const sessionToolDefinitions: Tool[] = [
  {
    name: 'session_start',
    description: `Begin a new agent session for a task. Call this FIRST at the start of every context window.

Returns:
- The full task object with context (workingDirectory, initScript, etc.)
- The last session's progressNote so you know exactly where the previous agent left off
- A count of remaining subtasks
- Your new session ID — save this, you need it for session_end

After calling this, you should:
1. Read the progressNote carefully
2. Run the initScript if present to verify the environment
3. Call subtask_get_next to find what to work on`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string', description: 'Unique ID for this agent instance' },
        phase: { type: 'string', enum: ['init', 'execution'], description: 'Use "init" for the very first session, "execution" for all subsequent ones' },
      },
      required: ['taskId', 'agentId', 'phase'],
    },
  },
  {
    name: 'session_end',
    description: `Close the current session and write a handoff note for the next agent. Call this LAST before your context window ends.

You MUST provide a progressNote that covers:
- What you accomplished this session
- What the next agent should work on first
- Any known bugs or blockers
- The current state of the environment

This note is the primary mechanism for continuity between sessions. Write it as if briefing a new engineer joining the project.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session ID returned from session_start' },
        agentId: { type: 'string' },
        progressNote: {
          type: 'string',
          description: 'Detailed handoff note for the next agent. Cover: what was done, current state, what to do next, any blockers.',
        },
        gitCommit: { type: 'string', description: 'Git commit SHA if you committed progress, optional' },
        tokenCount: { type: 'number', description: 'Approximate tokens used this session, optional' },
        status: {
          type: 'string',
          enum: ['completed', 'crashed', 'timed_out'],
          description: 'completed = normal end, crashed = unhandled error, timed_out = ran out of context',
        },
        subtasksAttempted: { type: 'array', items: { type: 'string' }, description: 'IDs of subtasks you attempted' },
        subtasksCompleted: { type: 'array', items: { type: 'string' }, description: 'IDs of subtasks you marked as passed' },
      },
      required: ['id', 'agentId', 'progressNote'],
    },
  },
]

export const handleSessionTool = async (name: string, args: unknown): Promise<string> => {
  switch (name) {
    case 'session_start': {
      const { taskId, agentId, phase } = SessionStartSchema.parse(args)
      const taskOid = new mongoose.Types.ObjectId(taskId)

      const task = await Task.findById(taskOid).lean()
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })

      const lastSession = await Session.findOne({ taskId: taskOid, status: 'completed' })
        .sort({ endedAt: -1 })
        .lean()

      const session = await Session.create({ taskId: taskOid, agentId, phase })

      const [remainingSubtasks, totalSubtasks, passedSubtasks] = await Promise.all([
        Subtask.countDocuments({ taskId: taskOid, status: { $in: ['pending', 'in_progress'] } }),
        Subtask.countDocuments({ taskId: taskOid }),
        Subtask.countDocuments({ taskId: taskOid, status: 'passed' }),
      ])

      return JSON.stringify({
        success: true,
        sessionId: session._id,
        task,
        lastProgressNote: lastSession?.progressNote ?? null,
        lastGitCommit: lastSession?.gitCommit ?? null,
        subtaskProgress: {
          total: totalSubtasks,
          passed: passedSubtasks,
          remaining: remainingSubtasks,
          percentComplete: totalSubtasks > 0 ? Math.round((passedSubtasks / totalSubtasks) * 100) : 0,
        },
        message: lastSession
          ? 'Previous session found. Read lastProgressNote before starting work.'
          : 'No previous sessions. This is the first session for this task.',
      })
    }

    case 'session_end': {
      const { id, agentId, progressNote, gitCommit, tokenCount, status, subtasksAttempted, subtasksCompleted } =
        SessionEndSchema.parse(args)

      const session = await Session.findOneAndUpdate(
        { _id: id, agentId },
        {
          $set: {
            progressNote,
            gitCommit: gitCommit ?? null,
            tokenCount: tokenCount ?? null,
            status,
            endedAt: new Date(),
            subtasksAttempted: subtasksAttempted.map((sid) => new mongoose.Types.ObjectId(sid)),
            subtasksCompleted: subtasksCompleted.map((sid) => new mongoose.Types.ObjectId(sid)),
          },
        },
        { new: true }
      ).lean()

      if (!session) return JSON.stringify({ success: false, error: 'Session not found or not owned by this agent' })
      return JSON.stringify({ success: true, session })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown session tool: ${name}` })
  }
}
