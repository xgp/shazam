import type {
  ActionResult,
  AgentId,
  AgentSession,
  CommentThread,
  DashboardData,
  HealthReport,
  IssueItem,
  MergeMethod,
  PullRequestItem,
  ReviewersPanel,
  ShazamIntent,
} from '../../shared/types.js'
import { readToken } from './token.js'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      // Only declare a JSON body when there is one: Fastify rejects an empty
      // body sent with `content-type: application/json` as a 400.
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { 'x-shazam-token': token } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, response.status)
  }

  return (await response.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  health: () => request<HealthReport>('/api/health'),
  dashboard: () => request<DashboardData>('/api/dashboard'),
  refresh: () => post<DashboardData>('/api/dashboard/refresh'),
  comments: (repo: string, number: number) =>
    request<CommentThread>(
      `/api/comments?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(number)}`,
    ),
  reviewers: (repo: string, number: number, q?: string) =>
    request<ReviewersPanel>(
      `/api/pr/reviewers?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(number)}${
        q ? `&q=${encodeURIComponent(q)}` : ''
      }`,
    ),
  editReviewers: (url: string, add: string[], remove: string[]) =>
    post<ActionResult>('/api/pr/reviewers', { url, add, remove }),
  merge: (url: string, method: MergeMethod, body?: string) =>
    post<ActionResult>('/api/pr/merge', { url, method, body }),
  approve: (url: string, body?: string) => post<ActionResult>('/api/pr/approve', { url, body }),
  closeIssue: (url: string, comment?: string) =>
    post<ActionResult>('/api/issue/close', { url, comment }),
  sessions: () => request<AgentSession[]>('/api/sessions'),
  shazam: (pr: PullRequestItem, agent: AgentId, intent: ShazamIntent = 'brief') =>
    post<AgentSession>('/api/sessions', {
      agent,
      intent,
      item: {
        kind: 'pull_request',
        id: pr.id,
        url: pr.url,
        number: pr.number,
        headRef: pr.headRef,
        repo: { nameWithOwner: pr.repo.nameWithOwner },
        headRepo: pr.headRepo
          ? { nameWithOwner: pr.headRepo.nameWithOwner, url: pr.headRepo.url }
          : null,
      },
    }),
  shazamIssue: (issue: IssueItem, agent: AgentId) =>
    post<AgentSession>('/api/sessions', {
      agent,
      intent: 'issue',
      item: {
        kind: 'issue',
        id: issue.id,
        url: issue.url,
        number: issue.number,
        repo: { nameWithOwner: issue.repo.nameWithOwner },
      },
    }),
  closeSession: (id: string) => request<ActionResult>(`/api/sessions/${id}`, { method: 'DELETE' }),
  openTerminal: (id: string) => post<AgentSession>(`/api/sessions/${id}/terminal`),
  closeTerminal: (id: string) =>
    request<ActionResult>(`/api/sessions/${id}/terminal`, { method: 'DELETE' }),
}

/** The websocket cannot set headers, so the token rides in the query string. */
export function ptyUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = readToken() ?? ''
  return `${protocol}//${window.location.host}/ws/pty?id=${encodeURIComponent(sessionId)}&t=${encodeURIComponent(token)}`
}
