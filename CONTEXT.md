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

### 2026-07-09

- **Linear MCP now loads; worked GAL-40, GAL-17, GAL-41 end to end.** The
  restart resolved the mid-session MCP gap from 07-08. Each request ran the full
  discipline: create/pull issue, In Progress + self-assign, commit referencing
  the issue, deploy where needed, In Review + reassign to Mark + testing-block
  comment.
- **GAL-40: added `/end-session` slash command.** Lives at
  `.claude/commands/end-session.md` (not gitignored), encodes the workspace
  Session-End Ritual and defers to the root `CLAUDE.md` as authoritative. It
  spells out the two-repo commit split (project repo vs workspace-root allowlist)
  because the project is a nested repo inside the workspace repo.
- **GAL-17: scoped the Repliers sample to the Chicago metro.** `fetch_repliers()`
  now injects `lat/long/radius` (41.8781 / -87.6298 / 50) only when the client
  sends no `map` viewport, so map pan/zoom is not fighting a fixed radius, and
  explicit client geo params still win. Env-overridable
  (`REPLIERS_DEFAULT_LAT/LONG/RADIUS`) so an Ontario cutover is config, not code.
  Verified live: `sourceCount=197`, all Chicago-metro. Corrected stale
  "~300 listings" target to "~200" in `tasks/plan.md` (canonical docs already
  said ~200); left the historical T8 finding intact.
- **GAL-41: added a "Model routing" section to `CLAUDE.md`.** standard -> Opus
  4.8, frontier -> Fable 5 via /model, with a per-issue Complexity assessment
  and a rule to note the model used in the In Review comment.

## Top-of-mind next steps

1. **Migrate the 32-item backlog inventory into Linear** (team GAL, project
   House Hunter - Alpha) with the type/milestone/readiness already assigned.
2. Drop the already-done "inline quick-rating from the mini-card" item from the
   backlog when migrating: it shipped this cycle (mini-card editable stars +
   inline note, deployed token 20260708-223600).
3. **Apply the new Model routing policy going forward**: add a Complexity label
   (frontier/standard) when creating GAL issues, and switch models before
   starting a frontier issue.
