const getArg = (name: string): string | undefined => {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`))
  return arg?.slice(name.length + 1)
}

const hasArg = (name: string) => process.argv.includes(name)

export type CliOptions = {
  stdio: boolean
  http: boolean
  https: boolean
  port?: number
  cert?: string
  key?: string
  certKey?: string
}

const DEFAULT_HTTP_PORT = 8000
const DEFAULT_HTTPS_PORT = 8443

export const parseCli = (): CliOptions => {
  const httpMode = hasArg('--http')
  const httpsMode = hasArg('--https')
  const portArg = getArg('--port')
  const port = portArg ? parseInt(portArg, 10) : undefined
  const cert = getArg('--cert')
  const key = getArg('--key')
  const certKey = getArg('--cert-key')

  const stdio = !httpMode && !httpsMode
  const http = httpMode || httpsMode
  const https = httpsMode

  return {
    stdio,
    http,
    https,
    port,
    cert,
    key,
    certKey,
  }
}

export { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT }
