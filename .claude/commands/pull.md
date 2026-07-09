---
description: Pull one or more Linear issues and run the full standard issue-pull workflow
argument-hint: GAL-NN [GAL-NN ...]
---

# Pull and work issues

Issues: **$ARGUMENTS**

Run the "Standard issue-pull procedure" from the project `CLAUDE.md`. That
section is authoritative; if it and the steps below ever disagree, follow
`CLAUDE.md`. Execute the whole workflow for `$ARGUMENTS` with no further
instruction. Do not ask to proceed between steps; only stop if something is
genuinely ambiguous (step 9).

**Multiple IDs:** `$ARGUMENTS` may name several issue IDs. Process them strictly
one at a time, completing the full workflow below (through the In Review
handoff, or the readiness skip) for one ID before starting the next. Never
interleave. When every ID is done, report a one-line status per issue (built and
in review, or skipped as needs-spec).

For each issue ID, in order:

1. **Fetch the issue and ALL its comments** from Linear via the Linear MCP
   (`get_issue`, then `list_comments`). Read the acceptance criteria, the
   description, and every comment in full.
2. **Determine mode:**
   - Status Backlog/Todo: fresh work. Build to the acceptance criteria.
   - Status In Progress or In Review with newer review comments: rework. Treat
     Mark's latest comments as the spec delta and fix per those comments, not
     the original scope.
3. **Readiness guard** (skip for rework driven by review comments). Check the
   issue's Readiness label before building. If it is `needs-spec`, do NOT build:
   comment on the issue listing the specific open questions blocking it, skip
   the issue, and continue to the next ID. Only `agent-ready` issues (or
   explicit rework per review comments) get built.
4. **Check the Complexity label** and switch models per the "Model routing"
   section of `CLAUDE.md` if needed (frontier -> Fable 5 via /model). Note the
   model you use for the In Review comment.
5. **Move the issue to In Progress and assign it to yourself** (`save_issue`,
   state "In Progress", assignee "me").
6. **Do the work.** Every commit references the issue: `Refs GAL-NN` or
   `Fixes GAL-NN`. Follow the project's writing and coding conventions (no em
   dashes, plain language). Keep the API key server-side; no pip deps.
7. **If the change affects the running app, deploy** with
   `bash scripts/deploy.sh` and confirm it exits 0 (the LaunchAgent does not
   hot-reload; a new route 404s until reload). When UI is touched, verify at the
   six-width layout standard (390/600/768/900/1024/1280, see DECISIONS.md).
   Verify the actual behavior end to end, not just that tests pass.
8. **Move to In Review, reassign to Mark**, and comment a testing block on the
   issue:
   - What changed
   - How to test: numbered steps starting from a URL or command
   - Expected result
   - Deployed: yes (househunter.galleonglobal.ai) or local only
   - Model used
   Never move the issue to Done.
9. **Anything ambiguous:** comment the question on the issue and stop. Side
   discoveries become new issues in Triage, never scope creep on the issue.
