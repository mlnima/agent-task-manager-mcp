import type { Request, Response, NextFunction } from 'express'

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const NGROK_SUFFIXES = ['.ngrok-free.app', '.ngrok.app', '.ngrok.io']

const getAllowedHosts = (): Set<string> => {
  const extra = process.env.MCP_ALLOWED_HOSTS
  if (!extra) return LOCALHOST_HOSTS
  const hosts = new Set(LOCALHOST_HOSTS)
  for (const h of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
    hosts.add(h)
  }
  return hosts
}

const isHostAllowed = (hostname: string): boolean => {
  if (LOCALHOST_HOSTS.has(hostname)) return true
  if (NGROK_SUFFIXES.some((s) => hostname.endsWith(s))) return true
  if (getAllowedHosts().has(hostname)) return true
  return false
}

export const hostValidationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const hostHeader = req.headers.host
  if (!hostHeader) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Missing Host header' },
      id: null,
    })
    return
  }
  let hostname: string
  try {
    hostname = new URL(`http://${hostHeader}`).hostname
  } catch {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Invalid Host header: ${hostHeader}` },
      id: null,
    })
    return
  }
  if (!isHostAllowed(hostname)) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Invalid Host: ${hostname}` },
      id: null,
    })
    return
  }
  next()
}
