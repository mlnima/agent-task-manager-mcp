import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import 'dotenv/config'

import connectDB from './db.js'
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
    await connectDB()

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

const main = async () => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] agent-task-manager-mcp server running on stdio')
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err)
  process.exit(1)
})
