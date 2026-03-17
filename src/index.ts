import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import 'dotenv/config'

import { parseCli } from './cli.js'
import { createMcpServer } from './server.js'
import { runHttpServer } from './http.server.js'

const main = async () => {
  const opts = parseCli()

  if (opts.stdio) {
    const server = createMcpServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('[MCP] agent-task-manager-mcp server running on stdio')
    console.error('[MCP] For HTTP/HTTPS with full URL run: npm run start:http  or  node dist/index.js --http')
    return
  }

  await runHttpServer({
    port: opts.port,
    https: opts.https,
    cert: opts.cert,
    key: opts.key,
    certKey: opts.certKey,
  })
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err)
  process.exit(1)
})
