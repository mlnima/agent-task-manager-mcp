/**
 * @module storage
 * Storage router and adapters for agent-task-manager-mcp.
 */
import { getRouter, toAgentJSON } from './router.js'
import { createMongoAdapter } from './adapters/mongodb.adapter.js'
import { createPostgresAdapter } from './adapters/postgres.adapter.js'
import { createSqliteAdapter } from './adapters/sqlite.adapter.js'
import { createJsonAdapter } from './adapters/json.adapter.js'

export { getRouter, toAgentJSON }
export type { StorageRouter, StorageType } from './router.js'
export type { StorageAdapter } from './interface.js'
export type { Task, Subtask, Session, Checkpoint } from './types.js'

/** @deprecated Use getRouter() instead. Kept for backward compatibility. */
export const getStorage = () => getRouter().getAdapter()

export { createMongoAdapter, createPostgresAdapter, createSqliteAdapter, createJsonAdapter }
