import { expect, test } from 'claude-code/testing'

const ACTIVE = {
  sessionId: 'local_a',
  title: 'Website redesign',
  isArchived: false,
  isRunning: false,
  lastActivityAt: new Date().toISOString(),
  group: { id: 'g1', name: 'Website' },
  link: 'claude://claude.ai/epitaxy/local_a',
}
const ARCHIVED = { ...ACTIVE, sessionId: 'local_b', title: 'Old bug hunt', isArchived: true, group: null }

const PANE = {
  plugin: 'all-sessions',
  component: 'Pane',
  requestId: 'all-sessions',
  props: {
    title: 'All sessions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('lists active and archived together, dims archived, restores one', async ($, on) => {
  let archived = true
  const restored: string[] = []
  const calls: string[] = []
  on('mcp.call', async (_$, e) => {
    if (e.tool === 'list_sessions') {
      const rows = [ACTIVE, { ...ARCHIVED, isArchived: archived }]
      return { value: { content: [{ type: 'text', text: JSON.stringify(rows) }], isError: false } }
    }
    if (e.tool === 'get_session') {
      // the session the pane runs in, which list_sessions leaves out
      const self = { ...ACTIVE, sessionId: 'local_self', title: 'This session', group: { id: 'g2', name: 'Plugins' } }
      return { value: { content: [{ type: 'text', text: JSON.stringify(self) }], isError: false } }
    }
    if (e.tool === 'list_sections') {
      const rows = [
        { id: 'pinned', kind: 'pinned', name: '' },
        { id: 'g1', kind: 'manual', name: 'Website' },
        { id: 'g2', kind: 'manual', name: 'Plugins' },
        { id: 'g3', kind: 'manual', name: 'Empty one' },
        { id: 'sessions', kind: 'sessions', name: '' },
      ]
      return { value: { content: [{ type: 'text', text: JSON.stringify(rows) }], isError: false } }
    }
    if (['set_pinned', 'set_unread', 'set_session_title', 'move_sessions', 'archive_session'].includes(e.tool)) {
      calls.push(`${e.tool} ${JSON.stringify(e.args)}`)
      return { value: { content: [{ type: 'text', text: 'ok' }], isError: false } }
    }
    if (e.tool === 'unarchive_session') {
      restored.push(String(e.args.session_id))
      archived = false
      return { value: { content: [{ type: 'text', text: 'ok' }], isError: false } }
    }
    return { value: { content: [], isError: true } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    archived = true
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'Refresh' })

    const active = await ui.find({ key: 'open-local_a' })
    const old = await ui.find({ key: 'open-local_b' })
    expect(active?.text).toMatch(/Website redesign/)
    expect(active?.props.dimColor).toBe(false)
    expect(old?.text).toMatch(/Old bug hunt/)
    expect(old?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'restore-local_a' })).toBeUndefined()

    // grouped as the sidebar is: the Website group, then ungrouped under Projects
    expect((await ui.find({ key: 'head-g1' }))?.text).toMatch(/Website/)
    expect((await ui.find({ key: 'head-sessions' }))?.text).toMatch(/Projects/)
    expect(await ui.find({ key: 'head-pinned' })).toBeUndefined()
    // this session shows under its own section, and an empty section still shows
    expect((await ui.find({ key: 'open-local_self' }))?.text).toMatch(/This session/)
    expect((await ui.find({ key: 'head-g3' }))?.text).toMatch(/Empty one/)
    await ui.press({ key: 'head-g1' })
    expect(await ui.find({ key: 'open-local_a' })).toBeUndefined()
    await ui.press({ key: 'head-g1' })

    await ui.press({ key: 'toggle-archived' })
    expect(await ui.find({ key: 'open-local_b' })).toBeUndefined()
    await ui.press({ key: 'toggle-archived' })

    // the ⋯ menu holds the sidebar's actions, in a card over the rows
    await ui.press({ key: 'more-local_a' })
    expect((await ui.find({ key: 'menu-local_a' }))?.props.position).toBe('absolute')
    await ui.press({ key: 'pin-local_a' })
    expect(calls.at(-1)).toMatch(/set_pinned .*"pinned":true/)
    await ui.press({ key: 'more-local_a' })
    await ui.press({ key: 'rename-local_a' })
    await ui.input({ key: 'title-local_a', text: 'Website renamed' })
    expect(calls.at(-1)).toMatch(/set_session_title .*Website renamed/)
    await ui.press({ key: 'more-local_a' })
    await ui.press({ key: 'moveto-local_a' })
    expect(await ui.find({ key: 'pin-local_a' })).toBeUndefined()
    await ui.press({ key: 'move-local_a-sessions' })
    expect(calls.at(-1)).toMatch(/move_sessions .*"section_id":"sessions"/)
    await ui.press({ key: 'more-local_a' })
    await ui.press({ key: 'archive-local_a' })
    expect(calls.at(-1)).toMatch(/archive_session/)

    await ui.press({ key: 'more-local_b' })
    await ui.press({ key: 'restore-local_b' })
    expect(restored.at(-1)).toBe('local_b')
    expect((await ui.find({ key: 'open-local_b' }))?.props.dimColor).toBe(false)
    await ui.unmount()
  }
})

test('the band button above the prompt opens the pane, and closes it again', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  let isUp = false
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    isUp = false
    return { value: undefined }
  })
  on('ui.panes', async () => ({
    value: isUp ? [{ id: 'all-sessions', title: 'All sessions', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: '[]' }], isError: false } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'all-sessions', surface, component: 'AbovePrompt', props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 4,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 4 },
        view: {},
      },
    })
    await ui.press({ key: 'open-all-sessions' })
    expect(opened.at(-1)).toBe('all-sessions')
    await ui.press({ key: 'open-all-sessions' })
    expect(closed.at(-1)).toBe('all-sessions')
    await ui.unmount()
  }
})
