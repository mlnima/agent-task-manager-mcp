# Tests

**Prerequisites:** Node 18+, `npm install` done. Optional: MongoDB, PostgreSQL for full backend coverage.

## Run

```bash
npm test              # All tests (json, sqlite, mcp-tools; postgres/mongodb if env set)
npm run test:storage  # Storage adapter tests only (uses current STORAGE env)
npm run test:mcp     # MCP tool invocation tests (uses JSON storage)
```

## Env vars per backend

| Backend   | Env vars                          |
|-----------|------------------------------------|
| json      | `STORAGE=json` `JSON_STORAGE_PATH` |
| sqlite    | `STORAGE=sqlite` `SQLITE_PATH`     |
| postgres  | `STORAGE=postgres` `POSTGRES_URL` or `DATABASE_URL` |
| mongodb   | `STORAGE=mongodb` `MONGODB_URI`    |

## Expected output

```
[OK] json storage tests passed
[OK] sqlite storage tests passed
[OK] MCP tool tests passed

--- Summary ---
  json: PASS
  sqlite: PASS
  mcp-tools: PASS
  3/3 passed
```
