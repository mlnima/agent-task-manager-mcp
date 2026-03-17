import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ensureTestDir, testJsonPath, cleanupJson } from './setup.js'

const AGENT_ID = 'test-mcp-agent'
const TSX = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')

const runTests = async () => {
  ensureTestDir()
  const jsonPath = testJsonPath()
  process.env.STORAGE = 'json'
  process.env.JSON_STORAGE_PATH = jsonPath

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX, 'src/index.ts'],
    env: { ...process.env, STORAGE: 'json', JSON_STORAGE_PATH: jsonPath },
    cwd: process.cwd(),
  })

  const client = new Client({ name: 'test', version: '1.0' })
  await client.connect(transport)

  try {
    const createRes = await client.callTool({ name: 'task_create', arguments: { title: 'MCP Test', description: 'Test task' } })
    const createText = createRes.content?.[0]?.type === 'text' ? createRes.content[0].text : ''
    const create = JSON.parse(createText)
    if (!create.success || !create.task?.id) throw new Error('task_create failed: ' + createText)
    const taskId = create.task.id

    const getRes = await client.callTool({ name: 'task_get', arguments: { id: taskId } })
    const getText = getRes.content?.[0]?.type === 'text' ? getRes.content[0].text : ''
    const get = JSON.parse(getText)
    if (!get.success || !get.task) throw new Error('task_get failed: ' + getText)

    const listRes = await client.callTool({ name: 'task_list', arguments: {} })
    const listText = listRes.content?.[0]?.type === 'text' ? listRes.content[0].text : ''
    const list = JSON.parse(listText)
    if (!list.success || !Array.isArray(list.tasks)) throw new Error('task_list failed: ' + listText)

    const bulkRes = await client.callTool({
      name: 'subtask_create_bulk',
      arguments: { taskId, subtasks: [{ title: 'Sub 1', description: 'Desc 1' }] },
    })
    const bulkText = bulkRes.content?.[0]?.type === 'text' ? bulkRes.content[0].text : ''
    const bulk = JSON.parse(bulkText)
    if (!bulk.success || !bulk.subtasks?.length) throw new Error('subtask_create_bulk failed: ' + bulkText)

    const nextRes = await client.callTool({ name: 'subtask_get_next', arguments: { taskId, agentId: AGENT_ID } })
    const nextText = nextRes.content?.[0]?.type === 'text' ? nextRes.content[0].text : ''
    const next = JSON.parse(nextText)
    if (!next.success || !next.subtask) throw new Error('subtask_get_next failed: ' + nextText)

    const subId = next.subtask.id
    const statusRes = await client.callTool({
      name: 'subtask_update_status',
      arguments: { id: subId, agentId: AGENT_ID, status: 'passed', evidence: 'verified' },
    })
    const statusText = statusRes.content?.[0]?.type === 'text' ? statusRes.content[0].text : ''
    const status = JSON.parse(statusText)
    if (!status.success) throw new Error('subtask_update_status failed: ' + statusText)

    const startRes = await client.callTool({ name: 'session_start', arguments: { taskId, agentId: AGENT_ID, phase: 'execution' } })
    const startText = startRes.content?.[0]?.type === 'text' ? startRes.content[0].text : ''
    const start = JSON.parse(startText)
    if (!start.success || !start.sessionId) throw new Error('session_start failed: ' + startText)
    const sessionId = start.sessionId

    const endRes = await client.callTool({
      name: 'session_end',
      arguments: { id: sessionId, agentId: AGENT_ID, progressNote: 'Test completed' },
    })
    const endText = endRes.content?.[0]?.type === 'text' ? endRes.content[0].text : ''
    const end = JSON.parse(endText)
    if (!end.success) throw new Error('session_end failed: ' + endText)

    const saveRes = await client.callTool({
      name: 'checkpoint_save',
      arguments: { taskId, sessionId, label: 'test-cp', snapshot: { x: 1 } },
    })
    const saveText = saveRes.content?.[0]?.type === 'text' ? saveRes.content[0].text : ''
    const save = JSON.parse(saveText)
    if (!save.success || !save.checkpoint) throw new Error('checkpoint_save failed: ' + saveText)

    const restoreRes = await client.callTool({ name: 'checkpoint_restore', arguments: { taskId, label: 'test-cp' } })
    const restoreText = restoreRes.content?.[0]?.type === 'text' ? restoreRes.content[0].text : ''
    const restore = JSON.parse(restoreText)
    if (!restore.success || !restore.checkpoint?.snapshot) throw new Error('checkpoint_restore failed: ' + restoreText)

    await client.callTool({ name: 'task_delete', arguments: { id: taskId } })

    console.log('[OK] MCP tool tests passed')
  } finally {
    await transport.close()
    cleanupJson()
  }
}

runTests().catch((err) => {
  console.error('[FAIL]', err)
  process.exit(1)
})
