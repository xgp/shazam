import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { HealthReport } from '../../shared/types.js'
import { approvePullRequest } from '../actions/approve.js'
import { closeIssue } from '../actions/close.js'
import { mergePullRequest } from '../actions/merge.js'
import { editReviewers } from '../actions/reviewers.js'
import type { SessionManager } from '../agent/sessions.js'
import { getComments } from '../github/comments.js'
import type { DashboardPoller } from '../github/poller.js'
import { fetchReviewers } from '../github/reviewers.js'

const repoRefSchema = z.object({ nameWithOwner: z.string().min(1), url: z.string().url() })

const shazamSchema = z.object({
  agent: z.enum(['claude', 'codex']),
  intent: z.enum(['brief', 'address', 'conflict', 'issue']).default('brief'),
  item: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('pull_request'),
      id: z.string().min(1),
      url: z.string().url(),
      number: z.number().int().positive(),
      headRef: z.string().min(1),
      repo: z.object({ nameWithOwner: z.string().min(1) }),
      headRepo: repoRefSchema.nullable().default(null),
    }),
    z.object({
      kind: z.literal('issue'),
      id: z.string().min(1),
      url: z.string().url(),
      number: z.number().int().positive(),
      repo: z.object({ nameWithOwner: z.string().min(1) }),
    }),
  ]),
})

const mergeSchema = z.object({
  url: z.string().url(),
  method: z.enum(['squash', 'merge', 'rebase']),
  body: z.string().max(4000).optional(),
})

const approveSchema = z.object({
  url: z.string().url(),
  body: z.string().max(4000).optional(),
})

const commentsSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'Expected owner/name'),
  number: z.coerce.number().int().positive(),
})

const closeIssueSchema = z.object({
  url: z.string().url(),
  comment: z.string().max(4000).optional(),
})

const repoNumberSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'Expected owner/name'),
  number: z.coerce.number().int().positive(),
})

/** A login, or "org/team". Anything else is not something gh can be handed. */
const loginSchema = z.string().regex(/^[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/)

const editReviewersSchema = z
  .object({
    url: z.string().url(),
    add: z.array(loginSchema).max(20).default([]),
    remove: z.array(loginSchema).max(20).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, 'Nothing to change')

export interface ApiDeps {
  poller: DashboardPoller
  sessions: SessionManager
  health: HealthReport
}

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { poller, sessions, health } = deps

  app.get('/api/health', async () => health)

  app.get('/api/dashboard', async () => {
    await poller.ready()
    return poller.snapshot
  })

  app.post('/api/dashboard/refresh', async () => poller.refresh())

  // Read on demand from a comment chip, not on the poll: the dashboard's one
  // request per minute should not grow with how chatty the repositories are.
  app.get('/api/comments', async (request, reply) => {
    const parsed = commentsSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    try {
      return await getComments(parsed.data.repo, parsed.data.number)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(502).send({ ok: false, message })
    }
  })

  app.get('/api/pr/reviewers', async (request, reply) => {
    const parsed = repoNumberSchema.extend({ q: z.string().max(100).optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    try {
      return await fetchReviewers(parsed.data.repo, parsed.data.number, parsed.data.q)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(502).send({ ok: false, message })
    }
  })

  app.post('/api/pr/reviewers', async (request, reply) => {
    const parsed = editReviewersSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    const result = await editReviewers(parsed.data.url, parsed.data.add, parsed.data.remove)
    // Requesting a review is what turns reviewDecision into "review required",
    // so the row itself changes; do not wait for the next poll to show it.
    if (result.ok) void poller.refresh()
    return result
  })

  app.post('/api/pr/merge', async (request, reply) => {
    const parsed = mergeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    const result = await mergePullRequest(parsed.data.url, parsed.data.method, parsed.data.body)
    // A merge changes several rows at once; refresh rather than wait for the poll.
    if (result.ok) void poller.refresh()
    return result
  })

  app.post('/api/pr/approve', async (request, reply) => {
    const parsed = approveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    const result = await approvePullRequest(parsed.data.url, parsed.data.body)
    if (result.ok) void poller.refresh()
    return result
  })

  app.post('/api/issue/close', async (request, reply) => {
    const parsed = closeIssueSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, message: 'Invalid request' })

    const result = await closeIssue(parsed.data.url, parsed.data.comment)
    if (result.ok) void poller.refresh()
    return result
  })

  app.get('/api/sessions', async () => sessions.list())

  app.post('/api/sessions', async (request, reply) => {
    const parsed = shazamSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' })
    }

    const agent = health.agents.find((a) => a.id === parsed.data.agent)
    if (!agent?.available) {
      return reply
        .code(409)
        .send({ ok: false, message: `${parsed.data.agent} is not installed or not on PATH` })
    }

    return sessions.create(parsed.data)
  })

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const closed = sessions.close(request.params.id)
    if (!closed) return reply.code(404).send({ ok: false, message: 'No such session' })
    return { ok: true, message: 'Session closed' }
  })

  // A companion shell in the agent's own worktree, opened beside it.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/terminal', async (request, reply) => {
    try {
      const terminal = await sessions.openTerminal(request.params.id)
      if (!terminal) return reply.code(404).send({ ok: false, message: 'No such session' })
      return terminal
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(409).send({ ok: false, message })
    }
  })

  app.delete<{ Params: { id: string } }>('/api/sessions/:id/terminal', async (request, reply) => {
    const closed = sessions.closeTerminal(request.params.id)
    if (!closed) return reply.code(404).send({ ok: false, message: 'No terminal open' })
    return { ok: true, message: 'Terminal closed' }
  })
}
