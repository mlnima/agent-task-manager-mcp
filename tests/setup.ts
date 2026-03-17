import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_DIR = join(process.cwd(), 'tests', 'data')

export const ensureTestDir = () => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  return TEST_DIR
}

export const testJsonPath = () => join(ensureTestDir(), 'test-json.json')
export const testSqlitePath = () => join(ensureTestDir(), 'test-sqlite.db')

export const cleanupJson = () => {
  const p = testJsonPath()
  if (existsSync(p)) rmSync(p)
}

export const cleanupSqlite = () => {
  try {
    const p = testSqlitePath()
    if (existsSync(p)) rmSync(p)
  } catch {
    // EBUSY on Windows when DB still open; next run overwrites
  }
}

export const assertHas = (obj: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    if (!(k in obj)) throw new Error(`Missing key: ${k}`)
  }
}
