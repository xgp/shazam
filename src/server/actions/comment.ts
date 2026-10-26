import type { ActionResult } from '../../shared/types.js'
import { runGh } from './gh.js'

/** A plain conversation comment on a PR or issue; gh tells PR from issue by URL. */
export function addComment(url: string, body: string): Promise<ActionResult> {
  return runGh(['pr', 'comment', url, '--body', body])
}
