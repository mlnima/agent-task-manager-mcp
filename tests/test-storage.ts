import { join } from 'node:path'
import { getRouter } from '../src/storage/index.js'
import { ensureTestDir, testJsonPath, testSqlitePath, cleanupJson, cleanupSqlite, assertHas } from './setup.js'

const AGENT_ID = 'test-agent-1'

const runTests = async () => {
  const storage = process.env.STORAGE ?? 'json'
  ensureTestDir()

  if (storage === 'json') process.env.JSON_STORAGE_PATH = testJsonPath()
  if (storage === 'sqlite') process.env.SQLITE_PATH = testSqlitePath()

  const router = getRouter()
  await router.connect()
  const adapter = router.getAdapter()

  const createdIds: { taskId?: string; subtaskId?: string; sessionId?: string; checkpointId?: string } = {}

  try {
    const task = await adapter.taskCreate({ title: 'Test Task', description: 'Test description' })
    assertHas(task as unknown as Record<string, unknown>, ['id', 'title', 'status', 'createdAt'])
    createdIds.taskId = task.id

    const found = await adapter.taskFindById(task.id)
    if (!found) throw new Error('taskFindById returned null')
    if (found.title !== 'Test Task') throw new Error('task title mismatch')

    const { tasks, total } = await adapter.taskList({ limit: 10, skip: 0 })
    if (total < 1 || tasks.length < 1) throw new Error('taskList empty')

    const updated = await adapter.taskUpdate(task.id, { status: 'initializing' })
    if (!updated || updated.status !== 'initializing') throw new Error('taskUpdate failed')

    const locked = await adapter.taskLock(task.id, AGENT_ID)
    if (!locked || locked.agentId !== AGENT_ID) throw new Error('taskLock failed')

    const subtasks = await adapter.subtaskCreateBulk(task.id, [
      { title: 'Sub 1', description: 'Desc 1' },
      { title: 'Sub 2', description: 'Desc 2' },
    ])
    if (subtasks.length !== 2) throw new Error('subtaskCreateBulk count mismatch')
    createdIds.subtaskId = subtasks[0].id

    const next = await adapter.subtaskGetNext(task.id, AGENT_ID)
    if (!next) throw new Error('subtaskGetNext returned null')

    const subUpdated = await adapter.subtaskUpdateStatus(next.id, AGENT_ID, {
      status: 'passed',
      evidence: 'verified',
    })
    if (!subUpdated || subUpdated.status !== 'passed') throw new Error('subtaskUpdateStatus failed')

    const session = await adapter.sessionCreate({ taskId: task.id, agentId: AGENT_ID, phase: 'init' })
    assertHas(session as unknown as Record<string, unknown>, ['id', 'taskId', 'agentId', 'startedAt'])
    createdIds.sessionId = session.id

    const lastSession = await adapter.sessionFindLatestByTask(task.id)
    if (!lastSession || lastSession.id !== session.id) throw new Error('sessionFindLatestByTask failed')

    await adapter.sessionUpdate(session.id, AGENT_ID, {
      progressNote: 'Done',
      status: 'completed',
      endedAt: new Date(),
    })

    const checkpoint = await adapter.checkpointCreate({
      taskId: task.id,
      sessionId: session.id,
      label: 'test-checkpoint',
      snapshot: { foo: 'bar' },
    })
    assertHas(checkpoint as unknown as Record<string, unknown>, ['id', 'label', 'snapshot', 'createdAt'])
    createdIds.checkpointId = checkpoint.id

    const cpFound = await adapter.checkpointFindByTaskAndLabel(task.id, 'test-checkpoint')
    if (!cpFound || cpFound.label !== 'test-checkpoint') throw new Error('checkpointFindByTaskAndLabel failed')

    const allCps = await adapter.checkpointFindAllByTask(task.id)
    if (allCps.length < 1) throw new Error('checkpointFindAllByTask empty')

    await adapter.taskUnlock(task.id, AGENT_ID)
    const unlocked = await adapter.taskFindById(task.id)
    if (unlocked?.agentId !== null) throw new Error('taskUnlock failed')

    await adapter.taskDelete(task.id)
    const afterDelete = await adapter.taskFindById(task.id)
    if (afterDelete) throw new Error('taskDelete did not remove task')

    console.log(`[OK] ${storage} storage tests passed`)
  } finally {
    if (storage === 'json') cleanupJson()
    if (storage === 'sqlite') cleanupSqlite()
  }
}

runTests().catch((err) => {
  console.error('[FAIL]', err)
  process.exit(1)
})
