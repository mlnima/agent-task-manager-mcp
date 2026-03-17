import 'dotenv/config'
import { createMongoAdapter } from './adapters/mongodb.adapter.js'
import { createPostgresAdapter } from './adapters/postgres.adapter.js'
import { createSqliteAdapter } from './adapters/sqlite.adapter.js'
import { createJsonAdapter } from './adapters/json.adapter.js'
import type { StorageAdapter } from './interface.js'

export type StorageType = 'mongodb' | 'postgres' | 'sqlite' | 'json'

let routerInstance: StorageRouter | null = null
let adapterInstance: StorageAdapter | null = null

/**
 * Normalize value for agent consumption: dates as ISO 8601, strip backend-specific fields.
 */
const normalizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === '_id' || k === '__v') continue
      out[k] = normalizeValue(v)
    }
    if ('_id' in obj && !('id' in out)) {
      const id = obj._id
      out.id = typeof id === 'string' ? id : id?.toString?.() ?? null
    }
    return out
  }
  return value
}

/**
 * Convert entity/response to JSON string for agent consumption.
 * Dates → ISO 8601, strips _id/__v, ensures consistent shape.
 * @param obj - Entity (Task, Subtask, Session, Checkpoint) or array
 * @returns JSON string with normalized dates and IDs
 */
export const toAgentJSON = (obj: unknown): string => {
  const normalized = normalizeValue(obj)
  return JSON.stringify(normalized)
}

/**
 * Storage router: routes to backend adapter and normalizes responses for agents.
 */
export class StorageRouter {
  private constructor() {}

  /** @internal */
  static instance = (): StorageRouter => {
    if (!routerInstance) routerInstance = new StorageRouter()
    return routerInstance
  }

  /** Resolve storage adapter from STORAGE env. Lazy-init on first use. */
  getAdapter = (): StorageAdapter => {
    if (adapterInstance) return adapterInstance

    const type = (process.env.STORAGE ?? 'mongodb').toLowerCase() as StorageType

    switch (type) {
      case 'mongodb':
        adapterInstance = createMongoAdapter()
        break
      case 'postgres': {
        const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
        if (!url) throw new Error('POSTGRES_URL or DATABASE_URL is required when STORAGE=postgres')
        adapterInstance = createPostgresAdapter(url)
        break
      }
      case 'sqlite':
        adapterInstance = createSqliteAdapter(process.env.SQLITE_PATH ?? './data/agent-tasks.db')
        break
      case 'json':
        adapterInstance = createJsonAdapter(process.env.JSON_STORAGE_PATH ?? './data/agent-tasks.json')
        break
      default:
        throw new Error(
          `Unknown STORAGE type: ${type}. Use mongodb, postgres, sqlite, or json.`
        )
    }

    return adapterInstance
  }

  /** Connect to the configured storage backend. */
  connect = async (): Promise<void> => {
    await this.getAdapter().connect()
  }

  toAgentJSON = toAgentJSON
}

/**
 * Single entry point for storage access.
 * Routes to MongoDB, PostgreSQL, SQLite, or JSON based on STORAGE env.
 * @returns StorageRouter singleton
 */
export const getRouter = (): StorageRouter => StorageRouter.instance()
