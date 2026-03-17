# Storage Architecture

**Status:** DEFINED (Phase 01)

---

## Overview

Enterprise-grade, multi-backend agent task management. Supports a swarm of agents with JSON-first contracts per [Anthropic's Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

---

## Supported Storage Backends

| Backend | Use Case | Config Env | Notes |
|---------|----------|------------|-------|
| **MongoDB** | Production, multi-agent, document store | `MONGODB_URI` | Current default |
| **PostgreSQL** | Enterprise, relational, high concurrency | `POSTGRES_URL` or `DATABASE_URL` | ACID, JSONB |
| **SQLite** | Local dev, single-file, no server | `SQLITE_PATH` | Zero config |
| **JSON** | Quick testing, single agent | `JSON_STORAGE_PATH` | File-based |
| **MySQL** | Enterprise, common in corps | `MYSQL_URL` | Optional future |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MCP TOOLS (task_*, subtask_*, session_*, checkpoint_*) │
│                         JSON in / JSON out only                          │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         STORAGE ROUTER                                    │
│  • getRouter() — single entry point                                      │
│  • toAgentJSON() — normalize dates, IDs, shape                            │
│  • Route by STORAGE env                                                  │
│  • Error handling, validation                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│  MongoDB  │   │PostgreSQL │   │  SQLite   │   │   JSON    │   │   MySQL   │
│  Adapter  │   │  Adapter  │   │  Adapter  │   │  Adapter  │   │  Adapter  │
└───────────┘   └───────────┘   └───────────┘   └───────────┘   └───────────┘
```

---

## JSON-First Contract

Per Anthropic: *"the model is less likely to inappropriately change or overwrite JSON files"*.

| Rule | Implementation |
|------|-----------------|
| All tool responses | JSON string, dates as ISO 8601 |
| All IDs | String (24 hex or UUID) |
| Consistent shape | Same structure regardless of backend |
| No backend leakage | No ObjectId, no driver-specific types |

---

## Directory Structure

```
src/
  storage/
    router.ts           # StorageRouter, getRouter(), toAgentJSON()
    types.ts            # Internal types
    interface.ts        # StorageAdapter interface
    index.ts            # Export getRouter() only
    adapters/
      mongodb.adapter.ts
      postgres.adapter.ts
      sqlite.adapter.ts
      json.adapter.ts
      mysql.adapter.ts  # Optional future
```
