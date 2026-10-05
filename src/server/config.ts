import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentId, MergeMethod } from '../shared/types.js'

export const SHAZAM_HOME = process.env.SHAZAM_HOME ?? join(homedir(), '.shazam')

const configSchema = z.object({
  /** Milliseconds between GitHub polls. Floor of 15s to stay friendly to the API. */
  pollIntervalMs: z.number().int().min(15_000).default(60_000),
  port: z.number().int().min(1).max(65535).default(4270),
  defaultAgent: z.enum(['claude', 'codex']).default('claude'),
  defaultMergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
  /** Max rows fetched per column. 100 is GitHub's own page ceiling for search. */
  perColumnLimit: z.number().int().min(1).max(100).default(100),
  /**
   * Pre-accept the agent workspace-trust prompt for worktrees shazam created,
   * so the first Shazam in a repository does not stop on a dialog. Only ever
   * applies to paths under this config's own mirrors/worktrees directories.
   */
  trustWorktrees: z.boolean().default(true),
  /** Font size, in px, for the embedded agent terminal. */
  terminalFontSize: z.number().int().min(8).max(48).default(20),
  /**
   * `{url}`, `{path}`, `{branch}`, `{repo}` and `{number}` are substituted
   * before the prompt is handed to the agent.
   */
  shazamPrompt: z
    .string()
    .default(
      [
        'You are working on pull request {url}.',
        '',
        'Start by loading it: `gh pr view {url} --comments` and `gh pr diff {url}`.',
        '',
        'You are in a git worktree at {path}, checked out to branch `{branch}` of {repo}.',
        'This worktree is dedicated to PR #{number}; you can commit and push from here.',
        '',
        'Review the PR description, its CI status, and any review comments or requested',
        'changes. Then summarize what needs doing and wait for my instruction before',
        'making any changes.',
      ].join('\n'),
    ),
  /**
   * Used instead of `shazamPrompt` when a session is opened from the wrench on
   * a pull request whose review asked for changes. Same substitutions.
   */
  shazamChangesPrompt: z
    .string()
    .default(
      [
        'You are working on pull request {url}, where a reviewer has requested changes.',
        '',
        'Start by loading it: `gh pr view {url} --comments` and `gh pr diff {url}`.',
        'Read every review comment and every requested change.',
        '',
        'You are in a git worktree at {path}, checked out to branch `{branch}` of {repo}.',
        'This worktree is dedicated to PR #{number}; you can commit and push from here.',
        '',
        'Work through the requested changes one at a time. Fix what is right to fix.',
        'Where you think the reviewer is wrong, do not quietly comply - say so and make',
        'the argument. Either way, respond to the thread on GitHub with what you did, or',
        'why you did not. Tell me what you plan to do before you push anything.',
      ].join('\n'),
    ),
  /**
   * Used instead of `shazamPrompt` when a session is opened from the wrench on
   * a pull request that conflicts with its base. Same substitutions.
   */
  shazamConflictPrompt: z
    .string()
    .default(
      [
        'You are working on pull request {url}, which has a merge conflict with its base branch.',
        '',
        'You are in a git worktree at {path}, checked out to branch `{branch}` of {repo}.',
        'This worktree is dedicated to PR #{number}; you can commit and push from here.',
        '',
        'Resolve it and get the branch mergeable again:',
        '',
        '1. `gh pr view {url}` for what this PR is for, and read the history on both',
        '   sides so you know what each side of the conflict was trying to do.',
        '2. Bring the base branch in - merge or rebase, whichever matches how this',
        '   repository has done it recently - and resolve every conflicting hunk.',
        '3. Resolve on the merits. Where both sides can stand, keep both. Where they',
        '   cannot, decide which survives and be able to say why. Never take one side',
        '   wholesale without reading what you are discarding.',
        '4. Build it and run the tests before committing.',
        '5. Commit and push to the PR branch.',
        '',
        'Then tell me what conflicted and how you resolved it. If the right resolution',
        'is a judgement call rather than a mechanical one, stop and ask me first.',
      ].join('\n'),
    ),
  /**
   * Used when a session is opened from the Shazam button on an issue. The
   * worktree is a fresh branch off the default one, not a PR head, so this is
   * the only prompt that asks the agent to decide whether the work is safe to
   * do on its own - and to open the pull request when it is.
   */
  shazamIssuePrompt: z
    .string()
    .default(
      [
        'You are given a GitHub issue: {url} in {repo}.',
        '',
        'Start by loading it: `gh issue view {url} --comments`.',
        '',
        'You are in a git worktree at {path}, on a fresh branch `{branch}` cut from the',
        'default branch of {repo}. You can commit and push from here.',
        '',
        'Your goal is to understand the issue, decide whether autonomous implementation is',
        'appropriate, and - when it is - deliver a complete, tested pull request.',
        '',
        '**1. Investigate before deciding**',
        '',
        'Read the issue, its discussion, and relevant linked epics, issues, and PRs. Inspect',
        'repository instructions, affected code, existing patterns, and tests. Follow',
        'references far enough to resolve requirements and dependencies without expanding',
        'into unrelated work.',
        '',
        'Identify the intended outcome, acceptance criteria, scope, and unresolved questions.',
        'Distinguish explicit requirements from your assumptions. Check whether the work is',
        'already implemented, underway, or blocked by another change.',
        '',
        '**2. Build a concrete plan and assess autonomy**',
        '',
        'Define the smallest complete implementation, the affected components, and how you',
        'will verify the result.',
        '',
        'Proceed without plan approval only when **all** of these conditions hold:',
        '',
        '* The expected behavior and acceptance criteria are clear enough to verify.',
        '* The change is bounded and follows established repository patterns.',
        '* It requires no consequential product or architecture decision.',
        '* It introduces no breaking public contract, destructive migration, significant',
        '  security or permissions change, or coordinated rollout.',
        '* Relevant validation is feasible with the available tools and environment.',
        '* Remaining uncertainties can be resolved through repository investigation or',
        '  low-risk, reversible implementation choices.',
        '',
        'Judge complexity by uncertainty, coupling, and consequences - not merely file count',
        'or estimated effort. A change spanning several files may qualify; a one-line change',
        'with broad consequences may not.',
        '',
        '**3. Choose the appropriate path**',
        '',
        '**If the work qualifies:** Briefly state your understanding, assumptions,',
        'implementation plan, and why it meets the autonomy threshold. Then implement',
        'immediately in the same session. Do not ask for plan approval or stop after',
        'presenting the plan.',
        '',
        '**If the work does not qualify:** Complete the useful investigation first. Present a',
        'concrete proposed plan, explain which threshold conditions are unmet, and ask only',
        'the questions needed to resolve them. Use interactive questions when available, with',
        'a recommended answer and the practical tradeoffs. Do not ask the user questions that',
        'the repository or linked context can answer. Wait for the necessary decisions or',
        'approval before implementation.',
        '',
        '**If the issue is already resolved, superseded, or blocked:** Explain the finding',
        'with supporting references and recommend the next action rather than creating',
        'unnecessary changes.',
        '',
        '**4. Implement and deliver**',
        '',
        'When proceeding:',
        '',
        '* Follow repository instructions and conventions. Keep changes focused on the issue.',
        '* Add or update meaningful tests and documentation where the behavior requires them.',
        '* Run relevant checks and inspect the final diff for correctness and unintended',
        '  changes.',
        '* If new evidence pushes the work above the autonomy threshold, pause before making',
        '  the consequential change. Explain the finding and request the specific decision',
        '  needed.',
        '* Commit the changes on `{branch}`, push it, and open a PR linked to issue',
        '  #{number}. This prompt authorizes those actions, but not merging, deploying, or',
        '  making unrelated changes.',
        '* Write a PR description covering the problem, implementation, acceptance criteria,',
        '  validation results, and any remaining limitations.',
        '',
        'Finish with the PR link and a concise summary of what changed and how it was',
        'verified. Never claim checks passed unless they ran successfully. If access or',
        'tooling prevents completion, state exactly what is complete, what remains blocked,',
        'and what is needed to finish.',
      ].join('\n'),
    ),
})

export type Config = z.infer<typeof configSchema> & {
  configPath: string
  mirrorsDir: string
  worktreesDir: string
}

export interface ConfigOverrides {
  port?: number
  pollIntervalMs?: number
}

let cached: Config | null = null

export function loadConfig(overrides: ConfigOverrides = {}): Config {
  if (cached) return cached

  const configPath = join(SHAZAM_HOME, 'config.json')
  let fromDisk: unknown = {}
  try {
    fromDisk = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    // A missing config file is the normal case; anything else is worth saying.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`shazam: ignoring unreadable ${configPath}: ${(err as Error).message}`)
    }
  }

  const parsed = configSchema.parse(fromDisk)
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  )

  cached = {
    ...parsed,
    ...defined,
    configPath,
    mirrorsDir: join(SHAZAM_HOME, 'mirrors'),
    worktreesDir: join(SHAZAM_HOME, 'worktrees'),
  }
  return cached
}

export const AGENT_LABELS: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
}
