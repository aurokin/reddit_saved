import type { PostRow } from "../types";

// ============================================================================
// Post-hoc quality filtering (--hide-low-quality)
//
// Two forms of the SAME predicate that must stay in lockstep:
// - qualityWhereClause(): SQL fragment for list/search/export queries
// - qualityReason(): JS labeler used for debugging and tests
// The lockstep contract is enforced by a table test that runs both against
// identical fixture rows.
//
// Thresholds (documented verbatim in the agent SKILL.md):
// - deleted/removed: author '[deleted]', or body/selftext '[deleted]'/'[removed]'
// - low-value comment: kind t1 AND score < 1 AND body shorter than 60 chars
// - bots: AutoModerator, sneakpeekbot; moderator-distinguished stickied rows
// ============================================================================

export const LOW_QUALITY_BOT_AUTHORS = ["AutoModerator", "sneakpeekbot"] as const;
export const LOW_QUALITY_COMMENT_MAX_SCORE = 1; // dropped when score < this
export const LOW_QUALITY_COMMENT_MIN_LENGTH = 60; // dropped when body length < this

const DELETED_MARKERS = ["[deleted]", "[removed]"] as const;

// NULL-safety: every nullable column is coalesced — a bare `p.body IN (...)`
// on a NULL body would make the whole OR chain NULL and NOT(...) would then
// silently exclude perfectly good rows.
const LOW_QUALITY_SQL = `(
  p.author = '[deleted]'
  OR coalesce(p.body, '') IN ('[deleted]', '[removed]')
  OR coalesce(p.selftext, '') IN ('[deleted]', '[removed]')
  OR p.author IN ('${LOW_QUALITY_BOT_AUTHORS.join("', '")}')
  OR (coalesce(p.distinguished, '') = 'moderator' AND coalesce(p.stickied, 0) = 1)
  OR (p.kind = 't1' AND p.score < ${LOW_QUALITY_COMMENT_MAX_SCORE} AND length(coalesce(p.body, '')) < ${LOW_QUALITY_COMMENT_MIN_LENGTH})
)`;

/** WHERE fragment (table alias `p`) that keeps only non-low-quality rows. */
export function qualityWhereClause(): string {
  return `NOT ${LOW_QUALITY_SQL}`;
}

export type QualityReason =
  | "drop:deleted"
  | "drop:removed"
  | "drop:bot"
  | "drop:mod-sticky"
  | "drop:low-score-short"
  | null;

/** JS twin of qualityWhereClause — null means the row is kept. */
export function qualityReason(row: PostRow): QualityReason {
  if (row.author === "[deleted]" || row.body === "[deleted]" || row.selftext === "[deleted]") {
    return "drop:deleted";
  }
  if (row.body === "[removed]" || row.selftext === "[removed]") {
    return "drop:removed";
  }
  if ((LOW_QUALITY_BOT_AUTHORS as readonly string[]).includes(row.author)) {
    return "drop:bot";
  }
  if (row.distinguished === "moderator" && row.stickied === 1) {
    return "drop:mod-sticky";
  }
  if (
    row.kind === "t1" &&
    row.score < LOW_QUALITY_COMMENT_MAX_SCORE &&
    (row.body ?? "").length < LOW_QUALITY_COMMENT_MIN_LENGTH
  ) {
    return "drop:low-score-short";
  }
  return null;
}
