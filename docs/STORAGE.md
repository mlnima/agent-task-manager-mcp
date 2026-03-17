# Storage Backends

Multi-backend storage for agent-task-manager-mcp. Choose MongoDB, PostgreSQL, SQLite, or JSON file based on your setup.

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
│  • toAgentJSON() — normalize dates, IDs, shape                           │
│  • Route by STORAGE env                                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│  MongoDB  │   │PostgreSQL │   │  SQLite   │   │   JSON    │
└───────────┘   └───────────┘   └───────────┘   └───────────┘
```

---

## JSON-First Contract

Per [Anthropic's Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): *"the model is less likely to inappropriately change or overwrite JSON files"*.

| Rule | Implementation |
|------|-----------------|
| All tool responses | JSON string, dates as ISO 8601 |
| All IDs | String (24 hex) |
| Consistent shape | Same structure regardless of backend |
| No backend leakage | No ObjectId, no driver-specific types |

---

## Per-Backend Setup

### MongoDB

**When to use:** Production, multi-agent, document store. Default backend.

**Required:** `MONGODB_URI`

**Examples:**

```env
# Local
MONGODB_URI=mongodb://localhost:27017/agent-tasks

# MongoDB Atlas
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/agent-tasks?retryWrites=true&w=majority

# Remote with auth
MONGODB_URI=mongodb://user:password@host:27017/agent-tasks?authSource=admin
```

**URL-encode** special characters in passwords (e.g., `@` → `%40`).

---

### PostgreSQL

**When to use:** Enterprise, multi-agent, swarm of agents. ACID, JSONB, high concurrency.

**Required:** `POSTGRES_URL` or `DATABASE_URL`

**Examples:**

```env
# Local
POSTGRES_URL=postgresql://user:password@localhost:5432/agent_tasks

# Supabase, Neon, Railway, etc.
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```

**Schema:** Tables are created automatically on first connect. No manual migration needed.

---

### SQLite

**When to use:** Local dev, no server, single-file. Zero config.

**Optional:** `SQLITE_PATH` (default: `./data/agent-tasks.db`)

**Examples:**

```env
STORAGE=sqlite
SQLITE_PATH=./data/agent-tasks.db
```

**Notes:** WAL mode enabled. Directory created if missing.

---

### JSON

**When to use:** Quick testing, single agent. No DB setup.

**Optional:** `JSON_STORAGE_PATH` (default: `./data/agent-tasks.json`)

**Examples:**

```env
STORAGE=json
JSON_STORAGE_PATH=./data/agent-tasks.json
```

**Caveats:** Single-writer. Not recommended for multiple agents. No transactions.

---

## Migration: Switching Backends

Data is not migrated automatically. To switch:

1. Export tasks from one backend (if needed; manual or via tools).
2. Set new `STORAGE` and required env vars.
3. Start fresh or import data.

IDs are shared across backends (24-char hex). Same task IDs work across MongoDB, PostgreSQL, SQLite, or JSON.

---

## Troubleshooting

| Issue | Check |
|-------|------|
| `MONGODB_URI is not set` | Set when `STORAGE=mongodb`; or switch to `sqlite`/`json` |
| `POSTGRES_URL or DATABASE_URL is required` | Set when `STORAGE=postgres` |
| `Unknown STORAGE type` | Use `mongodb`, `postgres`, `sqlite`, or `json` |
| Connection refused | DB running? Correct host/port? |
| Auth failed | Verify credentials; URL-encode special chars |
| Task already locked | Another agent holds lock; wait or unlock with correct agentId |
