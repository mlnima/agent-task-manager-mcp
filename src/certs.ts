import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import selfsigned from 'selfsigned'

export type CertKeyPair = { cert: string; key: string }

const PEM_PRIVATE_KEY = /-----BEGIN\s+(?:(?:RSA|EC)\s+)?PRIVATE KEY-----[\s\S]+?-----END\s+(?:(?:RSA|EC)\s+)?PRIVATE KEY-----/
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/

const loadFile = (path: string): string => {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`)
  return readFileSync(resolved, 'utf8')
}

const parseCombinedPem = (content: string): CertKeyPair | null => {
  const keyMatch = content.match(PEM_PRIVATE_KEY)
  const certMatch = content.match(PEM_CERTIFICATE)
  if (keyMatch && certMatch) return { key: keyMatch[0], cert: certMatch[0] }
  return null
}

export const loadCertKey = (opts: {
  cert?: string
  key?: string
  certKey?: string
}): CertKeyPair => {
  const { cert, key, certKey } = opts

  if (cert && key) {
    return { cert: loadFile(cert), key: loadFile(key) }
  }

  const path = certKey ?? cert
  if (path) {
    const content = loadFile(path)
    const parsed = parseCombinedPem(content)
    if (parsed) return parsed
    if (key) return { cert: content, key: loadFile(key) }
    throw new Error(
      `File ${path} must contain both PRIVATE KEY and CERTIFICATE PEM blocks, or use --key for separate key file`
    )
  }

  throw new Error('Certificate required for HTTPS. Use --cert, --key, or --cert-key')
}

export const generateSelfSigned = async (): Promise<CertKeyPair> => {
  const attrs = [{ name: 'commonName', value: 'localhost' }]
  const notAfter = new Date()
  notAfter.setFullYear(notAfter.getFullYear() + 1)
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: notAfter,
  })
  return { cert: pems.cert, key: pems.private }
}
