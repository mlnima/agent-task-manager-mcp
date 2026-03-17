import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getRouter, toAgentJSON } from '../storage/index.js'
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

const normalize = <T>(obj: T): T => JSON.parse(toAgentJSON(obj)) as T

export const handleSessionTool = async (name: string, args: unknown): Promise<string> => {
  const adapter = getRouter().getAdapter()

  switch (name) {
    case 'session_start': {
      const { taskId, agentId, phase } = SessionStartSchema.parse(args)

      const task = await adapter.taskFindById(taskId)
      if (!task) return JSON.stringify({ success: false, error: 'Task not found' })

      const lastSession = await adapter.sessionFindLatestByTask(taskId, 'completed')

      const session = await adapter.sessionCreate({ taskId, agentId, phase })

      const [remainingSubtasks, totalSubtasks, passedSubtasks] = await Promise.all([
        adapter.subtaskCountByTask(taskId, ['pending', 'in_progress']),
        adapter.subtaskCountByTask(taskId),
        adapter.subtaskCountByTask(taskId, 'passed'),
      ])

      return JSON.stringify({
        success: true,
        sessionId: session.id,
        task: normalize(task),
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

      const session = await adapter.sessionUpdate(id, agentId, {
        progressNote,
        gitCommit: gitCommit ?? null,
        tokenCount: tokenCount ?? null,
        status: status ?? 'completed',
        endedAt: new Date(),
        subtasksAttempted: subtasksAttempted ?? [],
        subtasksCompleted: subtasksCompleted ?? [],
      })

      if (!session) return JSON.stringify({ success: false, error: 'Session not found or not owned by this agent' })
      return JSON.stringify({ success: true, session: normalize(session) })
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown session tool: ${name}` })
  }
}
