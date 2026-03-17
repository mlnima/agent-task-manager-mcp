import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

const TEST_DIR = join(process.cwd(), 'tests', 'data')
const TSX = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')

const run = (env: Record<string, string>): Promise<boolean> =>
  new Promise((resolve) => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    const child = spawn(process.execPath, [TSX, 'tests/test-storage.ts'], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    child.on('close', (code) => resolve(code === 0))
  })

const runMcp = (): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX, 'tests/test-mcp-tools.ts'], {
      env: { ...process.env, STORAGE: 'json', JSON_STORAGE_PATH: join(TEST_DIR, 'test-json.json') },
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    child.on('close', (code) => resolve(code === 0))
  })

const main = async () => {
  const results: Record<string, boolean> = {}

  results['json'] = await run({ STORAGE: 'json', JSON_STORAGE_PATH: join(TEST_DIR, 'test-json.json') })
  results['sqlite'] = await run({ STORAGE: 'sqlite', SQLITE_PATH: join(TEST_DIR, 'test-sqlite.db') })

  const postgresUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
  if (postgresUrl) {
    results['postgres'] = await run({ STORAGE: 'postgres', POSTGRES_URL: postgresUrl })
  }
  if (process.env.MONGODB_URI) {
    results['mongodb'] = await run({ STORAGE: 'mongodb', MONGODB_URI: process.env.MONGODB_URI })
  }

  results['mcp-tools'] = await runMcp()

  const passed = Object.values(results).filter(Boolean).length
  const total = Object.keys(results).length
  console.log('\n--- Summary ---')
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v ? 'PASS' : 'FAIL'}`)
  }
  console.log(`  ${passed}/${total} passed`)
  process.exit(passed === total ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
