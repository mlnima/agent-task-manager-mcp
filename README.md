# Agent Task Manager MCP

**Enterprise-grade MCP server for managing long-running AI agent tasks across context windows and memory boundaries.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-green.svg)](https://modelcontextprotocol.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-ODM-green.svg)](https://mongoosejs.com/)

```bash
npm install -g agent-task-manager-mcp
```

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Integration](#integration)
- [Tool Reference](#tool-reference)
- [Data Model](#data-model)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## The Problem

### Context Window Limitation

AI agents operate within a fixed **context window** (e.g., 100K–200K tokens). Long-running tasks—building a full-stack app, migrating a codebase, implementing 50+ features—exceed this limit. When the context fills up:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT CONTEXT WINDOW (e.g., 128K tokens)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  [System Prompt] [Task Spec] [Code] [History] [Current Work] ...        │
│                                                                         │
│  ═══════════════════════════════════════════►  CONTEXT FULL             │
│                                              │                          │
│                                              ▼                          │
│                                    Agent "forgets" earlier work         │
│                                    No persistent state                  │
│                                    Duplicate effort                     │
│                                    Inconsistent handoffs                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Consequences

| Issue               | Impact                                        |
| ------------------- | --------------------------------------------- |
| **No persistence**  | Agent state is lost when context resets       |
| **No handoff**      | New agent instance has no idea what was done  |
| **Duplicate work**  | Same features implemented multiple times      |
| **No coordination** | Multiple agents can pick the same task        |
| **No audit trail**  | No record of sessions, progress, or decisions |

---

## The Solution

**Agent Task Manager MCP** provides a **persistent task orchestration layer** that lets agents:

1. **Create and decompose** large tasks into atomic subtasks
2. **Track progress** across sessions with evidence-based verification
3. **Hand off cleanly** via structured progress notes and checkpoints
4. **Coordinate** via task locking to prevent duplicate work
5. **Recover** from failures using named checkpoints

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT TASK MANAGER MCP                                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Agent Session 1          Agent Session 2          Agent Session 3              │
│   (Context Full)           (Fresh Context)         (Fresh Context)               │
│         │                         │                         │                    │
│         │  task_lock              │  session_start          │  subtask_get_next  │
│         │  session_start          │  lastProgressNote ◄─────┼── Continuity!      │
│         │  subtask_get_next       │  subtask_get_next       │                    │
│         │  [do work]              │  [do work]              │                    │
│         │  subtask_update_status  │  checkpoint_save        │                    │
│         │  session_end            │  session_end            │                    │
│         │  task_unlock            │  task_unlock            │                    │
│         │                         │                         │                    │
│         └─────────────────────────┴─────────────────────────┘                    │
│                                   │                                              │
│                                   ▼                                              │
│                    ┌───────────────────────────────┐                             │
│                    │         MongoDB               │                             │
│                    │  Tasks • Subtasks • Sessions  │                             │
│                    │  Checkpoints • Progress       │                             │
│                    └───────────────────────────────┘                             │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

### System Diagram

```mermaid
flowchart TB
    subgraph Client["AI Client (Claude, Cursor, etc.)"]
        Agent[AI Agent]
    end

    subgraph MCP["agent-task-manager-mcp"]
        Server[MCP Server]
        Tools[14 Tools]
        Server --> Tools
    end

    subgraph Storage["Persistence"]
        MongoDB[(MongoDB)]
    end

    Agent <-->|stdio/JSON-RPC| Server
    Server <-->|Mongoose| MongoDB

    subgraph ToolsDetail["Tool Categories"]
        T1[task_*]
        T2[subtask_*]
        T3[session_*]
        T4[checkpoint_*]
    end
    Tools --> ToolsDetail
```

### Component Flow

```mermaid
flowchart LR
    subgraph Init["Init Phase"]
        A1[task_create]
        A2[task_lock]
        A3[session_start]
        A4[subtask_create_bulk]
        A5[task_update]
        A6[session_end]
        A7[task_unlock]
    end

    subgraph Exec["Execution Phase"]
        B1[task_lock]
        B2[session_start]
        B3[subtask_get_next]
        B4[subtask_update_status]
        B5[checkpoint_save]
        B6[session_end]
        B7[task_unlock]
    end

    Init --> Exec
```

---

## How It Works

### Two-Phase Workflow

| Phase         | Purpose                                           | When                     |
| ------------- | ------------------------------------------------- | ------------------------ |
| **Init**      | Analyze spec, create subtask list, set up context | First session only       |
| **Execution** | Work on subtasks incrementally, verify, hand off  | Every subsequent session |

### Session Lifecycle (Visual)

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    SESSION START                        │
                    └─────────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         ▼                         │
                    │              task_lock(agentId)                   │
                    │                         │                         │
                    │                         ▼                         │
                    │              session_start(phase)                 │
                    │                         │                         │
                    │                         ▼                         │
                    │         ┌─── Read lastProgressNote ───┐           │
                    │         │   Run initScript if present │           │
                    │         └─────────────────────────────┘           │
                    │                         │                         │
                    │                         ▼                         │
                    │              subtask_get_next()                   │
                    │                         │                         │
                    │              ┌──────────┴─────────┐               │
                    │              │                    │               │
                    │         null (done)          subtask              │
                    │              │                    │               │
                    │              ▼                    ▼               │
                    │    task_update(completed)    [DO THE WORK]        │
                    │              │                    │               │
                    │              │                    ▼               │
                    │              │         subtask_update_status      │
                    │              │         (passed/failed + evidence) │
                    │              │                    │               │
                    │              │                    ▼               │
                    │              │         checkpoint_save (optional) │
                    │              │                    │               │
                    │              │                    └──► loop       │
                    │              │                         back       │
                    │              │                                    │
                    └──────────────┼────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────────────────────┐
                    │                  SESSION END                     │
                    │  session_end(progressNote, gitCommit, ...)       │
                    │  task_unlock(agentId)                            │
                    └──────────────────────────────────────────────────┘
```

### Problem → Solution Mapping

| Problem             | Solution                                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| Context overflow    | `session_end` writes `progressNote`; next agent reads via `session_start` |
| Lost state          | `checkpoint_save` / `checkpoint_restore` for rollback points              |
| Duplicate work      | `task_lock` / `task_unlock` for exclusive ownership                       |
| Unclear what's done | `subtask_update_status` with `evidence` (required for passed)             |
| Dependency ordering | `subtask_create_bulk` with `dependsOn`; `subtask_get_next` respects it    |
| No continuity       | `lastProgressNote` + `lastGitCommit` returned by `session_start`          |

---

## Features

- **14 MCP tools** for full task lifecycle
- **MongoDB persistence** with Mongoose ODM
- **Zod validation** on all tool inputs
- **Task locking** for multi-agent coordination
- **Evidence-based verification** (no passing without proof)
- **Checkpoint/restore** for risky operations
- **Session handoff** with structured progress notes

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **MongoDB** 6+ (local, remote IP, or Atlas)
- **MCP-compatible client** (Claude Desktop, Cursor, etc.)

### Installation

```bash
git clone <repository-url>
cd agent-task-manager-mcp
npm install
```

### Environment Setup

(optional and can be define in MCP config of the agent in MONGODB_URI)

```bash
cp .env.example .env
# Edit .env and set MONGODB_URI
```

### Run

```bash
# Production (compiled)
npm run build
npm start
```

---

## Configuration

### Environment Variables

| Variable      | Required | Description               | Example                                 |
| ------------- | -------- | ------------------------- | --------------------------------------- |
| `MONGODB_URI` | Yes      | MongoDB connection string | `mongodb://localhost:27017/agent-tasks` |

### MongoDB URI Examples

```env
# Local
MONGODB_URI=mongodb://localhost:27017/agent-tasks

# Remote IP (agent on IP1, MongoDB on IP2)
MONGODB_URI=mongodb://user:password@IP2:27017/agent-tasks?authSource=admin

# MongoDB Atlas (cloud)
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/agent-tasks?retryWrites=true&w=majority
```

> **Note:** URL-encode special characters in passwords (e.g., `@` → `%40`).

---

## Integration

### Claude Desktop

Add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
	"mcpServers": {
		"agent-task-manager-mcp": {
			"command": "npx",
			"args": ["tsx", "C:/path/to/agent-task-manager-mcp/src/index.ts"],
			"env": {
				"MONGODB_URI": "mongodb://localhost:27017/agent-tasks"
			}
		}
	}
}
```

### Cursor

Add to Cursor MCP settings (or `.cursor/mcp.json`):

```json
{
	"mcpServers": {
		"agent-task-manager-mcp": {
			"command": "npx",
			"args": ["tsx", "C:/path/to/agent-task-manager-mcp/src/index.ts"],
			"env": {
				"MONGODB_URI": "mongodb://localhost:27017/agent-tasks"
			}
		}
	}
}
```

---

## Tool Reference

### Task Tools (7)

| Tool          | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `task_create` | Create top-level task; returns ID for all subsequent ops             |
| `task_get`    | Get task by ID with subtask summary (total, passed, failed, pending) |
| `task_list`   | List tasks with filters (status, phase, tags, pagination)            |
| `task_update` | Update status, phase, context, metadata                              |
| `task_delete` | Permanently delete task and all related data                         |
| `task_lock`   | Claim exclusive ownership for agentId                                |
| `task_unlock` | Release ownership                                                    |

### Subtask Tools (3)

| Tool                    | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `subtask_create_bulk`   | Create full subtask list in one call; supports `dependsOn`  |
| `subtask_get_next`      | Get next pending subtask (deps satisfied, highest priority) |
| `subtask_update_status` | Mark passed/failed/blocked; `evidence` required for passed  |

### Session Tools (2)

| Tool            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `session_start` | Begin session; returns task, lastProgressNote, sessionId |
| `session_end`   | Close session with progressNote, gitCommit, status       |

### Checkpoint Tools (2)

| Tool                 | Description                                 |
| -------------------- | ------------------------------------------- |
| `checkpoint_save`    | Save named snapshot before risky operations |
| `checkpoint_restore` | Restore most recent checkpoint by label     |

---

## Data Model

```
Task
├── title, description, status, phase, priority, tags
├── agentId, lockedAt (locking)
├── context: { workingDirectory, initScript, repoUrl, environmentVars }
├── metadata, deadline, completedAt
└── 1:N → Subtask, Session

Subtask
├── taskId, title, description, category, steps
├── status, priority, dependsOn[], agentId
├── attempts, lastError, evidence
└── category: functional | ui | performance | security | test

Session
├── taskId, agentId, phase
├── startedAt, endedAt, status
├── subtasksAttempted[], subtasksCompleted[]
├── progressNote, gitCommit, tokenCount
└── status: active | completed | crashed | timed_out

Checkpoint
├── taskId, sessionId, label
└── snapshot (JSON)
```

---

## Security

| Consideration           | Recommendation                                                 |
| ----------------------- | -------------------------------------------------------------- |
| **MongoDB credentials** | Use env vars; never commit `.env`                              |
| **Network**             | Use TLS for remote MongoDB; allow only trusted IPs in firewall |
| **Task locking**        | Use unique `agentId` per instance to avoid conflicts           |
| **Sensitive data**      | Avoid storing secrets in `metadata` or `snapshot`              |

---

## Troubleshooting

| Issue                         | Check                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| `MONGODB_URI is not set`      | Ensure `.env` exists and is loaded; verify env in MCP config             |
| Connection refused            | MongoDB running? Correct host/port?                                      |
| Auth failed                   | Verify username/password; URL-encode special chars                       |
| Tool returns `success: false` | Inspect `error` field in JSON response                                   |
| Task already locked           | Another agent holds lock; wait or use `task_unlock` with correct agentId |

---

## Project Structure

```
agent-task-manager-mcp/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── db.ts              # MongoDB connection
│   ├── models/
│   │   ├── Task.ts
│   │   ├── Subtask.ts
│   │   ├── Session.ts
│   │   └── Checkpoint.ts
│   ├── tools/
│   │   ├── task.tools.ts
│   │   ├── subtask.tools.ts
│   │   ├── session.tools.ts
│   │   └── checkpoint.tools.ts
│   └── schemas/
│       └── zod.schemas.ts
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## License

Custom Please read the License.md
