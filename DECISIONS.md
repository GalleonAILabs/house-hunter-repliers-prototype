# Batch 2 Decisions Log

This file records every ambiguity resolved without stopping to ask, per the
batch kickoff instructions. Entries are added as work proceeds. A summary
section is added at the top once the batch is complete.

## Setup

**Ambiguity:** The kickoff instructions asked me to confirm a clean working
tree relative to the last commit, with no unrelated pending changes. The
actual working tree on `main` had five modified files and one untracked
file (`docs/design-spec.md`, `static/app.js`, `static/index.html`,
`static/styles.css`, `TODOS.md` modified; `docs/STATUS.md` untracked). This
was real, intentional, previously-reviewed work (a group sentiment card
feature and two CSS bug fixes) that earlier instructions explicitly said to
leave uncommitted rather than commit yet.

**Default chosen:** Stashed the existing changes on `main` with
`git stash push -u -m "pre-batch2: ..."` rather than committing them
myself (not asked to commit that work) or carrying them into this batch
(they are unrelated to T10-T19). This gives `batch2-ui-fixes` a genuinely
clean base without losing or committing anything. The stash is recoverable
with `git stash pop` on `main` (stash ref: `stash@{0}` at time of writing,
message `pre-batch2: uncommitted group-sentiment feature + bottom-bar CSS
fixes + STATUS.md, stashed to give batch2-ui-fixes a clean base`).

**Why:** Stashing is reversible and keeps the two bodies of work (the
already-built, already-reviewed group sentiment feature, and this new
batch) cleanly separated instead of mixing them into one branch history.

## T11: note data model investigation

**Investigation finding, as required before deciding the fix:** the note
data model is a list, not a single field, at the database layer.
`listing_feedback` is append-only; `handle_feedback_post()` always INSERTs a
new row, it never UPDATEs one. Every "note" action a person has ever taken
on a listing already exists as its own row with its own `created_at`. The
bug was entirely on the read side: `latest_feedback_for_listings()`
collapsed to a single `note` field holding only the most recent row's text,
discarding the rest, and never exposed that row's own timestamp (only an
aggregate `updated_at` across all action types combined). The frontend then
pre-filled the note composer with that single latest value on every open,
so "add a new note" and "edit the existing one" were indistinguishable and
both looked like "reopening the old note."

**Default chosen:** field fix for the write/compose interaction (Add opens
a blank composer, Edit opens pre-filled with the latest note. Both still
call the same existing `submitFeedback(item, 'note', {note}, ...)`, so the
already-append-only write path did not need to change at all), combined
with a small history list for the read/display side (`note_history`, all
past notes for that person on that listing, newest first, each with its
own `created_at`, added as a new field in `latest_feedback_for_listings()`
alongside the existing single-value fields, which are kept for backward
compatibility).

**Why not a pure field fix (single note + a separate timestamp, no
history):** the real backfilled POC comment data already contains multiple
dated entries manually concatenated into one string by the family before
this app existed (e.g. "2026-06-14: ... | 2026-06-18: ... | 2026-06-19:
..."). A real history list is not a bigger feature than what the family
was already doing by hand; it replaces manual date-prefixing and
pipe-concatenation with a structured feature the database already
supported for free. A pure field fix would have papered over the same
problem again (a person adding a third and fourth note over time would
still be flattened into "the note").

**Why not a bigger rework (editable history, per-entry delete, etc.):**
out of scope for this batch item. "Edit" here means: compose from the
latest note's text and save, which appends a new row that becomes the new
latest, not a true in-place update. This satisfies the requirement (add
and edit are distinct actions; new notes are timestamped) without adding
UPDATE/DELETE support to `listing_feedback`, which is a write-path change
the batch's global constraints say to avoid unless explicitly required.
