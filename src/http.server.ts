import { randomUUID } from 'node:crypto'
import { createServer as createNetServer } from 'node:net'
import https from 'node:https'
import type { Request, Response } from 'express'
import express from 'express'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { loadCertKey, generateSelfSigned } from './certs.js'
import { hostValidationMiddleware } from './hostValidation.js'
import { createMcpServer } from './server.js'

const DEFAULT_HTTP_PORT = 8000
const DEFAULT_HTTPS_PORT = 8443
const MAX_PORT_ATTEMPTS = 100

const RETRYABLE_CODES = new Set(['EADDRINUSE', 'EACCES'])

const findAvailablePort = (startPort: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port - startPort >= MAX_PORT_ATTEMPTS) {
        reject(
          new Error(
            `No available port found after ${MAX_PORT_ATTEMPTS} attempts`
          )
        )
        return
      }
      const server = createNetServer()
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (RETRYABLE_CODES.has(err.code ?? '')) {
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })

type TransportMap = Record<
  string,
  InstanceType<typeof StreamableHTTPServerTransport>
>

export type HttpServerOptions = {
  port?: number
  https?: boolean
  cert?: string
  key?: string
  certKey?: string
}

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use(hostValidationMiddleware)
  return app
}

const runHttpServer = async (opts: HttpServerOptions = {}) => {
  const {
    port: requestedPort,
    https: useHttps,
    cert,
    key,
    certKey,
  } = opts

  const defaultPort = useHttps ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT
  const startPort = requestedPort ?? defaultPort
  const port = await findAvailablePort(startPort)

  if (port !== startPort) {
    console.error(`[MCP] Port ${startPort} busy (EADDRINUSE/EACCES), using ${port}`)
  } else {
    console.error(`[MCP] Port ${port} available`)
  }

  let tlsOptions: { key: string; cert: string } | null = null
  if (useHttps) {
    if (cert || certKey) {
      tlsOptions = loadCertKey({ cert, key, certKey })
    } else {
      tlsOptions = await generateSelfSigned()
      console.error('[MCP] No cert provided, using auto-generated self-signed')
    }
  }

  const app = createApp()
  const transports: TransportMap = {}

  const mcpPostHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const body = req.body

    try {
      let transport: InstanceType<typeof StreamableHTTPServerTransport>

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
      } else if (!sessionId && body && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (sid) transports[sid] = transport
          },
        })
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports[sid]) delete transports[sid]
        }
        const server = createMcpServer()
        await server.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        })
        return
      }

      await transport.handleRequest(req, res, body)
    } catch (err) {
      console.error('[MCP] HTTP handler error:', err)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    }
  }

  const mcpGetHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await transports[sessionId].handleRequest(req, res)
  }

  const mcpDeleteHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    try {
      await transports[sessionId].handleRequest(req, res)
    } catch (err) {
      console.error('[MCP] Session delete error:', err)
      if (!res.headersSent)
        res.status(500).send('Error processing session termination')
    }
  }

  app.post('/mcp', mcpPostHandler)
  app.get('/mcp', mcpGetHandler)
  app.delete('/mcp', mcpDeleteHandler)

  const protocol = useHttps ? 'https' : 'http'
  const shutdown = async () => {
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close()
      } catch {
        /* ignore */
      }
      delete transports[sid]
    }
    server.close()
  }

  const fullUrl = `${protocol}://127.0.0.1:${port}/mcp`

  let server: ReturnType<typeof app.listen> | https.Server
  if (useHttps && tlsOptions) {
    server = https.createServer(tlsOptions, app)
    server.listen(port, '127.0.0.1', () => {
      console.error('[MCP] Server started successfully')
      console.error(`[MCP] Full URL: ${fullUrl}`)
      console.error(`[MCP] Use this URL in ChatGPT Desktop or other MCP clients`)
    })
  } else {
    server = app.listen(port, '127.0.0.1', () => {
      console.error('[MCP] Server started successfully')
      console.error(`[MCP] Full URL: ${fullUrl}`)
      console.error(`[MCP] Use this URL in ChatGPT Desktop or other MCP clients`)
    })
  }

  process.on('SIGINT', () => {
    shutdown().then(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    shutdown().then(() => process.exit(0))
  })
}

export { findAvailablePort, runHttpServer, DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT }
