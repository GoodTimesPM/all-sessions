export type SessionRow = {
  id: string
  title: string
  // the sidebar section id: a custom group's id, or 'sessions' for ungrouped
  sectionId: string
  isPinned: boolean
  isArchived: boolean
  isRunning: boolean
  lastActivityAt: string
  link: string | null
}

export type Section = { id: string; name: string }

declare module 'claude-code' {
  interface PluginState {
    'all-sessions': {
      sessions: SessionRow[]
      // the sidebar's sections in its order
      sections: Section[]
      // null when the last load worked
      error: string | null
      showArchived: boolean
      collapsed: string[]
      // the session whose actions row is open, and the one being renamed
      menuFor: string | null
      renaming: string | null
      // the session whose menu shows the Move to list
      moving: string | null
    }
  }
}
