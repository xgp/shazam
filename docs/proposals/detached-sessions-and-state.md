# Proposal: detached sessions and persistent state

**Status:** not scheduled. Written up so the reasoning survives.

Two wants, from the same afternoon:

1. Sessions should not die when a window closes. Losing a running agent to an
   accident is the worst failure this tool has.
2. shazam should remember things across restarts — enough to start sessions by
   itself when GitHub changes (a review comment lands, CI goes red), and to
   guarantee it starts *exactly one*.

Neither needs Electron. The first is a process-lifetime problem, the second is a
storage problem, and a desktop shell solves neither. What Electron is good for is
covered at the end.

## What actually kills a session today

Not the browser. PTYs are owned by the server process and held in
`SessionManager`'s map; the websocket is a viewer. `routes/pty.ts` detaches on
close and leaves the process running, and `attach()` replays up to 256 KB of
scrollback to whoever reconnects, so closing a tab and reopening it is already a
non-event.

Sessions die when the *server* dies:

- Ctrl-C, or closing the terminal that ran `shazam serve` — SIGHUP reaches the
  server, `stop()` calls `sessions.closeAll()`, and the PTY masters close under
  the agents.
- `npm run dev`, where `tsx watch` restarts the server on every file save. In
  development this is the usual culprit, and it looks exactly like "my window
  did something".

So the fix is to stop the server being a foreground child of a terminal.

## Phase 1 — detach the server

`shazam start | stop | status`, where `start` spawns the serve process with
`detached: true`, `stdio: 'ignore'` and `.unref()`, then returns. State for the
running daemon — pid, port, token — goes in `~/.shazam/daemon.json`; output goes
to `~/.shazam/shazam.log`. `shazam open` opens a browser at the daemon that is
already running rather than starting a second one, and `serve` stays exactly as
it is for anyone who wants it in the foreground.

A macOS LaunchAgent (`~/Library/LaunchAgents/io.shazam.plist`, `RunAtLoad`) makes
it come back after a reboot. On Linux, a user systemd unit.

After this, the terminal, the editor and the browser are all detachable viewers,
and the only thing that ends a session is ending it.

### The honest caveat, and the tmux variant

Detaching makes sessions survive everything except a restart of the daemon
itself. Scrollback is in memory and capped at `BUFFER_LIMIT`, so a crash loses
both the agents and their history.

If sessions should be genuinely immortal, shazam should not own the PTY at all.
Launch each agent inside its own tmux session —
`tmux new-session -d -s shazam-<id> -c <worktree> <agent command>` — and let
shazam's pty be `tmux attach -t shazam-<id>`. Then:

- a shazam crash, upgrade or restart leaves every agent running, and the dock
  repopulates from `tmux list-sessions`;
- scrollback becomes tmux's problem, with a far bigger buffer than 256 KB;
- you can attach from a real terminal when the UI is the thing misbehaving,
  which is a genuinely useful escape hatch;
- `~/.shazam/state.json` only has to remember metadata, not output.

The costs: tmux becomes a hard dependency (a preflight entry), the agent no
longer has shazam as its direct parent so exit codes arrive by polling
`list-sessions` rather than through `onExit`, and there is a second place where
sessions can be killed from. Worth it if phase 1 alone proves too fragile; the
daemon is the cheaper first move and does not block this.

## Phase 2 — persistent state

Everything is in memory today, and `~/.shazam/config.json` is read-only. Add a
store — a JSON file is enough at this size, `node:sqlite` if queries start to
matter and Node 22 is a safe floor — holding:

- **session records**: id, item, intent, worktree, branch, timestamps, exit
  code. The dock survives a restart, and closed sessions become history rather
  than nothing.
- **a trigger ledger**: per item, the id or timestamp of the last GitHub event
  acted on. This is what stops a restart re-firing on events already handled.
- **the last poll snapshot**, so the first poll after a restart diffs against
  reality instead of against an empty board.

### Exactly one session, guaranteed

A reservation key, `${itemId}:${intent}`:

- `create()` is already synchronous up to inserting the record — the clone
  happens in a floating `prepareAndSpawn` — so a check-and-insert before the
  first `await` is race-free on Node's single thread. Take the key there.
- If a `preparing` or `running` session holds the key, return it instead of
  spawning a second one.
- If the holder has `exited`, allow a new session only when the triggering event
  is newer than the ledger's watermark for that item.
- Persist the key to session-id map, so a daemon restart does not double-fire.

There is already a weaker version of this in the filesystem: worktree paths are
deterministic per (repo, number) and `ensureWorktree` reports `reused`, so two
sessions on one PR would fight over one checkout. The key makes that explicit
instead of incidental.

### Auto-starting on GitHub changes

`fetchDashboard(limit, previous)` already takes the previous snapshot, so a rules
layer sits naturally on top: diff each poll, emit transitions — changes
requested, a new comment by someone other than you, CI gone red, became
conflicting — and map each transition to an intent and a `create()` under the
reservation key. Polling stays; webhooks would need a public endpoint for no real
gain at a 60s interval.

Two things this must not ship without:

**A throttle and a kill switch.** Repo allowlist, a cap on concurrent
auto-started sessions, and a global off. Agents that spawn themselves from
GitHub events are how you come back to forty `claude` processes and a
rate-limit ban.

**An authenticated trigger.** An auto-started session feeds a stranger's comment
text to an agent that `shazamIssuePrompt` explicitly authorises to commit, push
and open a pull request. That is prompt injection with a write path. Fire only
on something only you can do — you adding a `shazam` label — or restrict
auto-start to repos you own and keep comment-driven triggers on read-only
intents. Auto-launching the issue prompt from any commenter on a public
repository is the one version of this not worth building.

## Why not Electron

It was the starting question, and it answers neither want. Done the obvious way
it makes the first one worse: the server moves into the main process, and
quitting the app kills every agent. `node-pty` is a native module, so it also
brings `electron-rebuild` against Electron's ABI and per-platform prebuilds —
onto a PTY setup already fragile enough to need `ensureSpawnHelperExecutable()`
— plus Developer ID signing and notarisation, ~150 MB an install, and an
auto-update story.

What it is actually good for is the shell: a dock icon, a tray showing "2
working, 1 waiting", and native notifications when a session goes quiet and
wants you — the one thing a background tab genuinely cannot do. Most of the rest
is available today by installing the page as an app from Chrome.

If it ever happens, it should be a client of the daemon, not its host: look for
a running daemon, spawn one detached if absent, load
`http://127.0.0.1:4270/?t=…` in a window. Quitting the app then leaves the
agents running, and `npx shazam serve` keeps working for anyone who does not
want a browser bundled with their dashboard. That inversion is the whole trick,
and phases 1 and 2 are what make it a few hundred lines instead of a rewrite.
