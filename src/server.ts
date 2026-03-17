import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { getRouter } from './storage/index.js'
import { taskToolDefinitions, handleTaskTool } from './tools/task.tools.js'
import {
  subtaskToolDefinitions,
  handleSubtaskTool,
} from './tools/subtask.tools.js'
import {
  sessionToolDefinitions,
  handleSessionTool,
} from './tools/session.tools.js'
import {
  checkpointToolDefinitions,
  handleCheckpointTool,
} from './tools/checkpoint.tools.js'

const allTools = [
  ...taskToolDefinitions,
  ...subtaskToolDefinitions,
  ...sessionToolDefinitions,
  ...checkpointToolDefinitions,
]

export const createMcpServer = () => {
  const server = new Server(
    { name: 'agent-task-manager-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      await getRouter().connect()

      let result: string

      if (name.startsWith('task_')) {
        result = await handleTaskTool(name, args)
      } else if (name.startsWith('subtask_')) {
        result = await handleSubtaskTool(name, args)
      } else if (name.startsWith('session_')) {
        result = await handleSessionTool(name, args)
      } else if (name.startsWith('checkpoint_')) {
        result = await handleCheckpointTool(name, args)
      } else {
        result = JSON.stringify({
          success: false,
          error: `Unknown tool: ${name}`,
        })
      }

      return { content: [{ type: 'text', text: result }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[MCP] Tool "${name}" error:`, message)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: message }),
          },
        ],
        isError: true,
      }
    }
  })

  return server
}
