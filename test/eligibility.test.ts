import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type LifecycleFacts,
  type WorkingCopyFacts,
  decide,
  isDisposable,
  meaningfulChanges,
} from '../src/server/agent/eligibility.js'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-22T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

const finished = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  state: { kind: 'merged', at: ago(48) },
  activeSession: false,
  openPullRequestOnBranch: false,
  ...over,
})
const clean: WorkingCopyFacts = { status: [], headOnRemote: true }

describe('decide', () => {
  it('removes a merged PR worktree that is clean and pushed', () => {
    const d = decide(finished(), clean, NOW, 24)
    assert.equal(d.remove, true)
    assert.equal(d.reason, 'merged 2d ago')
  })

  it('removes a closed PR or issue worktree past the grace period', () => {
    const d = decide(finished({ state: { kind: 'closed', at: ago(30) } }), clean, NOW, 24)
    assert.deepEqual(d, { remove: true, reason: 'closed 30h ago' })
  })

  it('keeps an open PR or issue', () => {
    const d = decide(finished({ state: { kind: 'open' } }), clean, NOW, 24)
    assert.deepEqual(d, { remove: false, reason: 'still open' })
  })

  it('keeps one whose state GitHub could not give', () => {
    const d = decide(finished({ state: { kind: 'unknown', reason: 'not found' } }), clean, NOW, 0)
    assert.equal(d.remove, false)
    assert.match(d.reason, /state unknown/)
  })

  it('keeps one a live session is using, even when merged', () => {
    const d = decide(finished({ activeSession: true }), clean, NOW, 24)
    assert.deepEqual(d, { remove: false, reason: 'a session is using it' })
  })

  it('keeps a closed issue whose branch still has an open PR', () => {
    const d = decide(
      finished({ state: { kind: 'closed', at: ago(48) }, openPullRequestOnBranch: true }),
      clean,
      NOW,
      24,
    )
    assert.equal(d.remove, false)
    assert.match(d.reason, /open pull request/)
  })

  it('waits out the grace period', () => {
    const d = decide(finished({ state: { kind: 'merged', at: ago(3) } }), clean, NOW, 24)
    assert.equal(d.remove, false)
    assert.match(d.reason, /merged 3h ago; grace period has 21h left/)
  })

  it('a grace period of 0 removes straight away', () => {
    const d = decide(finished({ state: { kind: 'merged', at: ago(0.01) } }), clean, NOW, 0)
    assert.equal(d.remove, true)
  })

  it('waits when the grace period applies but GitHub gave no time', () => {
    const d = decide(finished({ state: { kind: 'closed', at: null } }), clean, NOW, 24)
    assert.equal(d.remove, false)
  })

  it('keeps a dirty worktree', () => {
    const d = decide(finished(), { status: [' M src/index.ts', 'A  new.ts'], headOnRemote: true }, NOW, 24)
    assert.equal(d.remove, false)
    assert.match(d.reason, /uncommitted changes \(M src\/index.ts, A {2}new.ts\)/)
  })

  it('keeps a worktree with untracked work', () => {
    const d = decide(finished(), { status: ['?? notes.md'], headOnRemote: true }, NOW, 24)
    assert.equal(d.remove, false)
  })

  it('ignores untracked caches and build output', () => {
    const status = ['?? node_modules/', '?? pkg/__pycache__/', '?? .pytest_cache/', '?? dist/', '?? a.pyc', '?? .claude/settings.local.json']
    assert.equal(decide(finished(), { status, headOnRemote: true }, NOW, 24).remove, true)
  })

  it('keeps a worktree with unpushed commits', () => {
    const d = decide(finished(), { status: [], headOnRemote: false }, NOW, 24)
    assert.deepEqual(d, { remove: false, reason: 'HEAD has commits not found on any remote ref' })
  })

  it('checks sessions and state before the working copy', () => {
    const d = decide(finished({ state: { kind: 'open' } }), { status: [' M x'], headOnRemote: false }, NOW, 24)
    assert.equal(d.reason, 'still open')
  })
})

describe('isDisposable', () => {
  it('never treats tracked changes as disposable, cache name or not', () => {
    assert.equal(isDisposable(' M node_modules/x/package.json'), false)
    assert.equal(isDisposable('D  dist/index.js'), false)
  })

  it('matches cache directories at any depth', () => {
    assert.equal(isDisposable('?? web/node_modules/'), true)
    assert.equal(isDisposable('?? src/app/__pycache__/'), true)
  })

  it('keeps real new files and directories', () => {
    assert.deepEqual(meaningfulChanges(['?? src/feature.ts', '?? docs/', '?? node_modules/']), [
      '?? src/feature.ts',
      '?? docs/',
    ])
  })
})
