import type { AgentId, ShazamIntent } from '../../shared/types.js'
import { loadConfig } from '../config.js'
import { codexTrustArgs, trustClaudeWorkspace } from './trust.js'

export interface LaunchSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface LaunchContext {
  prompt: string
  /** The worktree the agent will run in. */
  cwd: string
  /** Canonical git root for that worktree - the bare mirror. */
  gitRoot: string
  /** Whether the user opted into pre-trusting shazam's own worktrees. */
  trustWorktrees: boolean
}

export interface AgentAdapter {
  id: AgentId
  label: string
  /** Build the argv that starts an interactive session seeded with a prompt. */
  launch(ctx: LaunchContext): LaunchSpec
  /**
   * Work the adapter must do outside argv before spawning. Returns a line for
   * the session terminal, or null when there is nothing worth saying.
   */
  prepare?(ctx: LaunchContext): string | null
}

const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  launch: (ctx) => ({
    command: 'claude',
    // A positional prompt starts the interactive TUI with that first turn.
    args: [ctx.prompt],
    env: {},
  }),
  // Claude Code has no trust flag, so the grant is recorded the way its own
  // dialog would record it - against the mirror, once per repository.
  prepare: (ctx) => {
    if (!ctx.trustWorktrees) return null
    const outcome = trustClaudeWorkspace(ctx.gitRoot, loadConfig().mirrorsDir)
    if (outcome === 'granted') return 'Marked this repository trusted for Claude Code'
    if (outcome === 'failed') return 'Could not pre-trust this workspace; Claude Code will ask'
    return null
  },
}

const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  // Codex accepts per-invocation config overrides, so it needs no file writing.
  launch: (ctx) => ({
    command: 'codex',
    args: [
      ...(ctx.trustWorktrees ? codexTrustArgs(ctx.cwd, loadConfig().worktreesDir) : []),
      ctx.prompt,
    ],
    env: {},
  }),
}

const ADAPTERS: Record<AgentId, AgentAdapter> = { claude, codex }

export function getAdapter(id: AgentId): AgentAdapter {
  const adapter = ADAPTERS[id]
  if (!adapter) throw new Error(`Unknown agent: ${id}`)
  return adapter
}

export interface PromptContext {
  pr: { url: string; number: number; repo: { nameWithOwner: string } }
  path: string
  branch: string
  /** Which of the configured prompts to open with. */
  intent: ShazamIntent
}

export function buildPrompt(ctx: PromptContext): string {
  const config = loadConfig()
  const template: string = {
    brief: config.shazamPrompt,
    address: config.shazamChangesPrompt,
    conflict: config.shazamConflictPrompt,
    issue: config.shazamIssuePrompt,
  }[ctx.intent]
  return template
    .replaceAll('{url}', ctx.pr.url)
    .replaceAll('{number}', String(ctx.pr.number))
    .replaceAll('{repo}', ctx.pr.repo.nameWithOwner)
    .replaceAll('{path}', ctx.path)
    .replaceAll('{branch}', ctx.branch)
}
