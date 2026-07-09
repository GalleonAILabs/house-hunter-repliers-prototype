# House Hunter: Session Context

Running project context for future sessions. The detailed per-session decision
log lives in `DECISIONS.md` (authoritative for what shipped and why); the
prioritized outstanding-work list is `docs/backlog-roadmap.md`; this file holds
session-level lessons and top-of-mind next steps.

## Lessons Learned

### 2026-07-08

- **Linear is now the tracker for this project.** Added a "Linear discipline"
  section to `CLAUDE.md` (team GAL, project House Hunter - Alpha): every Mark
  request becomes a GAL issue (In Progress + self-assign, do work with commits
  referencing GAL-NNN, then In Review + reassign to Mark + a testing-block
  comment, never Done). Side work goes to a new Triage issue, never scope-creep
  on the current one.
- **Backlog inventory compiled for migration.** Swept every source (TODOS.md,
  docs/backlog-roadmap.md, DECISIONS.md follow-ups/NEEDS-MARK, CLAUDE.md,
  code-comment grep, deploy.sh) into 32 dedup'd items with type + milestone +
  readiness, ready to load into Linear. Milestones map: A-section to Alpha,
  B-section to V1, C-section to V2. The B-section (commercial v1) is a dependency
  chain rooted in real authentication (replace the shared-secret token first).
- **Linear MCP was configured but not usable this session.** `linear-server` is
  in `~/.claude.json` (global + project-scoped), but MCP tools load at session
  start, so they were absent mid-session. GAL-17 could not be pulled. See the
  global lesson in `brain/lessons.md`.
- **Recovery-audit method.** When asked whether the prior session's fixes were
  lost, verified against the live deployed assets (fetched app.js/styles.css and
  grepped for markers), not just git log. Confirmed the prior batch was committed
  AND live; the only real gaps were two half-done items (mobile layers scroll,
  control-icon z-order), which became new work. Nothing had been reverted.

## Top-of-mind next steps

1. **Restart the session so the Linear MCP loads**, then pull GAL-17, move it to
   In Progress, and work it per the CLAUDE.md Linear discipline.
2. **Migrate the 32-item backlog inventory into Linear** (team GAL, project
   House Hunter - Alpha) with the type/milestone/readiness already assigned.
3. Drop the already-done "inline quick-rating from the mini-card" item from the
   backlog when migrating: it shipped this cycle (mini-card editable stars +
   inline note, deployed token 20260708-223600).
