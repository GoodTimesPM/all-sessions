import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Section, SessionRow } from '../types'

const PANE = 'all-sessions'
const SESSIONS = 'ccd_session_mgmt'
const SIDEBAR = 'ccd_sidebar'

const sessions = atom({ plugin: 'all-sessions', key: 'sessions' } as const, [])
const sections = atom({ plugin: 'all-sessions', key: 'sections' } as const, [])
const error = atom({ plugin: 'all-sessions', key: 'error' } as const, null)
const showArchived = atom({ plugin: 'all-sessions', key: 'showArchived' } as const, true)
// sections start collapsed; this holds the ones opened
const expanded = atom({ plugin: 'all-sessions', key: 'expanded' } as const, [])
const menuFor = atom({ plugin: 'all-sessions', key: 'menuFor' } as const, null)
const renaming = atom({ plugin: 'all-sessions', key: 'renaming' } as const, null)
const moving = atom({ plugin: 'all-sessions', key: 'moving' } as const, null)
const waiting = atom({ plugin: 'all-sessions', key: 'waiting' } as const, false)

type RawSession = {
  sessionId: string
  title?: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
  group?: { id: string; name: string } | null
  pinned?: boolean
  link?: string
}

type RawSection = { id: string; kind: string; name: string }

// "3m", "5h", "2d"
export const age = (iso: string, now: number): string => {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 60 / 24)}d`
}

export const toRows = (raw: RawSession[]): SessionRow[] =>
  raw.map(s => ({
    id: s.sessionId,
    title: s.title?.trim() || '(untitled)',
    sectionId: s.group?.id ?? 'sessions',
    isPinned: s.pinned === true,
    isArchived: s.isArchived === true,
    isRunning: s.isRunning === true,
    lastActivityAt: s.lastActivityAt ?? new Date(0).toISOString(),
    link: s.link ?? null,
  }))

// The sidebar's own order; its built-in list at the bottom is labeled Projects
export const toSections = (raw: RawSection[]): Section[] =>
  raw
    .filter(s => s.kind === 'pinned' || s.kind === 'manual' || s.kind === 'sessions')
    .map(s => ({
      id: s.id,
      name: s.kind === 'pinned' ? 'Pinned' : s.kind === 'sessions' ? 'Projects' : s.name,
    }))

// Each section with the sessions it holds; a pinned session sits under Pinned
export const bySection = (list: Section[], rows: SessionRow[]) => {
  const order = list.length > 0 ? list : [{ id: 'sessions', name: 'Projects' }]
  const known = new Set(order.map(s => s.id))
  return order
    .map(section => ({
      section,
      rows: rows.filter(r => {
        if (section.id === 'pinned') return r.isPinned
        if (r.isPinned && known.has('pinned')) return false
        if (section.id === 'sessions') return r.sectionId === 'sessions' || !known.has(r.sectionId)
        return r.sectionId === section.id
      }),
    }))
    // a section of your own shows while empty, as the sidebar's does
    .filter(g => g.rows.length > 0 || (g.section.id !== 'pinned' && g.section.id !== 'sessions'))
}

const textOf = (res: { content: { type: string; text?: string }[] }) =>
  res.content.map(b => (b.type === 'text' ? b.text ?? '' : '')).join('')

// true when the session list loaded; a quiet load keeps a failure off the pane
async function load($: EngineInterface, quiet = false): Promise<boolean> {
  let ok = false
  try {
    const res = await $.mcp.call(SESSIONS, 'list_sessions', { include_archived: true, limit: 200 })
    if (res.isError) throw new Error(textOf(res) || 'list_sessions failed')
    const raw = JSON.parse(textOf(res)) as RawSession[]
    // list_sessions leaves out the session that asks, which is the one this
    // pane is drawn in; get_session "self" puts it back
    try {
      const self = await $.mcp.call(SESSIONS, 'get_session', { session_id: 'self' })
      if (!self.isError) {
        const row = JSON.parse(textOf(self)) as RawSession
        if (row.sessionId && !raw.some(r => r.sessionId === row.sessionId)) raw.unshift(row)
      }
    } catch {}
    await update($, sessions, () => toRows(raw))
    await update($, error, () => null)
    ok = true
  } catch (err) {
    if (!quiet) await update($, error, () => String(err instanceof Error ? err.message : err))
  }
  // Without the sidebar's sections the pane falls back to one list
  try {
    const res = await $.mcp.call(SIDEBAR, 'list_sections', {})
    if (!res.isError) await update($, sections, () => toSections(JSON.parse(textOf(res)) as RawSection[]))
  } catch {}
  return ok
}

// A new session draws the pane before the app can check its tool calls
// ("Session state unavailable"), so the first loads fail. It tries quietly
// every two seconds for two minutes, then shows the error; a prompt sent
// meanwhile tries again too
async function loadWhenReady($: EngineInterface) {
  await update($, waiting, () => true)
  try {
    for (let tries = 0; tries < 60; tries++) {
      if (await load($, tries < 59)) return
      await $.clock.sleep(2000)
    }
  } finally {
    await update($, waiting, () => false)
  }
}

// Runs one app tool for a session, toasts the outcome, reloads the list
async function act($: EngineInterface, server: string, tool: string, args: Record<string, unknown>, done: string) {
  try {
    const res = await $.mcp.call(server, tool, args)
    $.ui.toast(res.isError ? textOf(res) || `${tool} failed` : done)
  } catch (err) {
    $.ui.toast(String(err instanceof Error ? err.message : err))
  }
  await update($, menuFor, () => null)
  await update($, renaming, () => null)
  await update($, moving, () => null)
  await load($)
}

// claude:// links open through the OS: explorer.exe on Windows (which exits 1
// even when it worked, so only a launch failure moves on), open on macOS,
// xdg-open on Linux
async function openLink($: EngineInterface, link: string) {
  for (const opener of ['explorer.exe', 'open', 'xdg-open']) {
    try {
      await $.process.run([opener, link])
      return
    } catch {}
  }
  $.ui.toast('Could not open the session link')
}

// The band button: closes the pane when it is the one showing, else opens it
async function togglePane($: EngineInterface) {
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (pane?.isShown) await $.ui.close({ id: PANE })
  else await openPane($)
}

async function openPane($: EngineInterface) {
  // A width close to the real sidebar's; a width the person dragged wins
  await $.ui.open({ id: PANE, title: 'All sessions', columns: 44 })
  await loadWhenReady($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'all-sessions',
      description: 'Show active and archived sessions in one pane',
    })
    void openPane($)

    return next(e)
  })

  // The first prompt of a new session means its state is there now
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, waiting)) || (await read($, error))) void load($)
    return next(e)
  })

  on('command.run', { command: 'all-sessions' }, async $ => {
    await openPane($)

    return { text: 'All sessions pane opened.' }
  })

  // One click from the prompt, for sessions where the right panel is shut
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    // other plugins' band buttons (Loadout's) draw beside this one
    const below = await next(e).catch(() => null)

    return (
      <Box flexDirection="row" gap={1}>
        <Button key="open-all-sessions" label="All sessions" onPress={() => void togglePane($)} />
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The mobile app draws no fields: rename is left out there
    const Input = 'Input' in table ? table.Input : undefined
    const list = await read($, sessions)
    const order = await read($, sections)
    const failed = await read($, error)
    const isWaiting = await read($, waiting)
    const withArchived = await read($, showArchived)
    const opened = await read($, expanded)
    const openMenu = await read($, menuFor)
    const editing = await read($, renaming)
    const movingFor = await read($, moving)
    const now = Date.now()
    const shown = withArchived ? list : list.filter(s => !s.isArchived)
    const archivedCount = list.filter(s => s.isArchived).length
    const targets = (order.length > 0 ? order : [{ id: 'sessions', name: 'Projects' }]).filter(t => t.id !== 'pinned')

    const open = (s: SessionRow) => {
      if (s.link) void openLink($, s.link)
    }
    const toggle = (id: string) =>
      void update($, expanded, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))

    const rule = (k: string) => (
      <Text key={k} color="#2a2a2a">
        {'─'.repeat(20)}
      </Text>
    )
    const item = (k: string, label: string, mark: string, onPress: () => void, color?: string) => (
      <Box key={`item-${k}`} flexDirection="row" justifyContent="space-between" hover={{ backgroundColor: '#2a2a2a' }}>
        <Button key={k} plain onPress={onPress}>
          <Text color={color}>{label}</Text>
        </Button>
        <Text dimColor>{mark}</Text>
      </Box>
    )

    // A card drawn over the rows (above them near the end of the list), so
    // opening it moves nothing, as the sidebar's own menu does
    const menu = (s: SessionRow) =>
      movingFor === s.id
        ? [
            item(`back-${s.id}`, '‹ Move to', '', () => void update($, moving, () => null)),
            rule(`rule-m-${s.id}`),
            ...targets.map(t =>
              item(`move-${s.id}-${t.id}`, t.name, t.id === s.sectionId ? '✓' : '', () =>
                void act($, SIDEBAR, 'move_sessions', { session_ids: [s.id], section_id: t.id }, `Moved to ${t.name}`),
              ),
            ),
          ]
        : Input && editing === s.id
          ? [
              <Input key={`title-${s.id}`} label="New title" value={s.title} submitLabel="Save" autoFocus
                onSubmit={value => value.trim() && void act($, SESSIONS, 'set_session_title', { session_id: s.id, title: value.trim() }, 'Renamed')} />,
            ]
          : [
              item(`pin-${s.id}`, s.isPinned ? 'Unpin' : 'Pin', '', () =>
                void act($, SIDEBAR, 'set_pinned', { session_id: s.id, pinned: !s.isPinned }, s.isPinned ? 'Unpinned' : 'Pinned'),
              ),
              item(`unread-${s.id}`, 'Mark as unread', '', () =>
                void act($, SIDEBAR, 'set_unread', { session_id: s.id, unread: true }, 'Marked as unread'),
              ),
              ...(Input ? [item(`rename-${s.id}`, 'Rename', '', () => void update($, renaming, () => s.id))] : []),
              rule(`rule-1-${s.id}`),
              item(`moveto-${s.id}`, 'Move to', '›', () => void update($, moving, () => s.id)),
              rule(`rule-2-${s.id}`),
              s.isArchived
                ? item(`restore-${s.id}`, 'Restore', '', () =>
                    void act($, SESSIONS, 'unarchive_session', { session_id: s.id }, `Restored "${s.title}"`),
                  )
                : item(`archive-${s.id}`, 'Archive', '', () =>
                    void act($, SESSIONS, 'archive_session', { session_id: s.id, reason: 'Archived from the All sessions pane' }, `Archived "${s.title}"`),
                  ),
              item(`delete-${s.id}`, 'Delete', '', () =>
                void act($, SESSIONS, 'delete_session', { session_ids: [s.id], reason: 'Deleted from the All sessions pane' }, 'Delete sent for your approval'),
                '#e5534b',
              ),
            ]
    const actions = (s: SessionRow, upward: boolean) => (
      <Box key={`menu-${s.id}`} position="absolute" right={0} {...(upward ? { bottom: 1 } : { top: 1 })} width={24}
        flexDirection="column" backgroundColor="#1c1c1c" borderStyle="round" borderColor="#2a2a2a" paddingX={1}>
        {menu(s)}
      </Box>
    )

    const groups = bySection(order, shown)
    // the last few rows drawn open their menu upward, so the pane edge cannot clip it
    const drawn = groups.flatMap(g => (!opened.includes(g.section.id) ? [] : g.rows.map(r => r.id)))
    const upward = (id: string) => drawn.indexOf(id) >= Math.max(0, drawn.length - 4)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button label="Refresh" onPress={() => void load($)} />
          <Button
            key="toggle-archived"
            label={withArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
            onPress={() => void update($, showArchived, v => !v)}
          />
        </Box>
        {failed && <Text color="red">Could not load sessions: {failed}</Text>}
        {!failed && isWaiting && list.length === 0 && <Text dimColor>Waiting for the app to load this session…</Text>}
        {!failed && !isWaiting && archivedCount === 0 && (
          <Text dimColor>The app's session list has no archived sessions in it yet.</Text>
        )}
        {!failed && !isWaiting && shown.length === 0 && <Text dimColor>No sessions.</Text>}
        {groups.map(({ section, rows }) => {
          const isClosed = !opened.includes(section.id)
          return (
            <Box key={`sec-${section.id}`} flexDirection="column" marginTop={1}>
              <Box key={`bar-${section.id}`} backgroundColor="#1c1c1c" borderStyle="round" borderColor="#2a2a2a" paddingX={1}>
                <Button key={`head-${section.id}`} plain onPress={() => toggle(section.id)}>
                  <Text bold>
                    {isClosed ? '▸' : '▾'} {section.name}
                  </Text>{' '}
                  <Text dimColor>{rows.length}</Text>
                </Button>
              </Box>
              {!isClosed &&
                rows.map(s => (
                  <Box key={`row-${s.id}`} flexDirection="column" position="relative">
                    <Box key={s.id} flexDirection="row" justifyContent="space-between" paddingLeft={2} marginTop={1}>
                      <Button key={`open-${s.id}`} plain dimColor={s.isArchived} onPress={() => open(s)}>
                        {s.isRunning ? '● ' : ''}
                        {s.title}
                      </Button>
                      <Box flexDirection="row" gap={1}>
                        <Text dimColor>
                          {s.isArchived ? 'archived · ' : ''}
                          {age(s.lastActivityAt, now)}
                        </Text>
                        <Button key={`more-${s.id}`} plain label="⋯"
                          onPress={() => {
                            void update($, moving, () => null)
                            void update($, renaming, () => null)
                            void update($, menuFor, id => (id === s.id ? null : s.id))
                          }} />
                      </Box>
                    </Box>
                    {openMenu === s.id && actions(s, upward(s.id))}
                  </Box>
                ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
