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
