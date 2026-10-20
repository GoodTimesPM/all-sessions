# All sessions

A Claude Code plugin for the desktop app's Code tab. It adds a pane that
lists your active and archived sessions together, grouped under the same
sections as your sidebar, with archived ones dimmed.

## Why

With the sidebar set to sections, an archived session disappears from it.
The only way back to it is the Sessions page, under View all and then the
Archived tab. Archiving is also the easiest way to free memory, since each
live session process holds a couple hundred megabytes. So you end up
choosing between a lighter app and being able to find your old work.
[anthropics/claude-code#102654](https://github.com/anthropics/claude-code/issues/102654)
asks for archived sessions to stay in the sidebar, dimmed. This plugin
does that in a pane until the app does it itself.

## What it does

- **One list, your sections.** Sessions sit under Pinned, your own
  sections, then Projects, in the sidebar's order. Each section header
  collapses.
- **Archived sessions dimmed**, marked "archived" next to their age. A
  button at the top hides or shows them and counts them.
- **Click a title to open that session.**
- **The sidebar's session menu.** The `⋯` on each row opens a floating
  card with Pin, Mark as unread, Rename, Move to, Archive or Restore, and
  Delete. The card draws over the rows, so opening it moves nothing. Delete
  goes through the app's own approval card.
- **A button above the prompt.** "All sessions" opens the pane, and closes
  it again when it is the one showing. The pane also opens at the start of
  each session, and `/all-sessions` opens it from the prompt.

## Install

In the Code tab, run:

```
/plugin marketplace add GoodTimesPM/all-sessions
/plugin install all-sessions@all-sessions
```

Then `/reload-plugins`, or start a new session.

## What it can't do

- **Older archived sessions.** The pane asks the app for its session list,
  and the app returns only sessions archived recently. Ones archived long
  ago are still on the Sessions page, but they never show up here.
- **Fork, and Open in a split or a new window.** The app gives plugins no
  way to fork a session, and it opens splits only for sessions the plugin's
  own session started.
- **The top bar or the left side.** Plugins draw in panes on the right and
  in the band above the prompt. That is why the button lives above the
  prompt.

## How it works

`hooks/register.tsx` is the whole plugin. It reads sessions through the
app's `ccd_session_mgmt` tools and the sidebar's sections through
`ccd_sidebar`, and every menu action is a call to one of those tools. The
pane redraws from a few state values declared in `types/index.d.ts`.

## Developing

Clone it, then load it from the folder:

```
claude plugin marketplace add ./all-sessions
claude plugin install all-sessions@all-sessions
```

The plugin reads from that folder, so an edit plus `/reload-plugins` shows
the change. Check it with:

```
claude plugin validate .
claude plugin test .
```

## License

MIT
