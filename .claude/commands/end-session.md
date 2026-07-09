---
description: Run the Galleon Session-End Ritual (log lessons, commit, push)
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Session-End Ritual

Run the ritual defined in the workspace root `CLAUDE.md` ("Session-End Ritual"
section). That file is authoritative; if it and these steps ever disagree,
follow `CLAUDE.md`. Execute the steps below in order. Step 1 may ask one
question; everything else is automatic. Do not ask for confirmation between
steps.

The workspace root is the Galleon Drive folder
(`~/Library/CloudStorage/GoogleDrive-mark@galleonglobal.ai/My Drive/Galleon`,
also reachable as `~/Google Drive/My Drive/Galleon`). Software projects live
under `projects/<name>/`. This project is `house-hunter-repliers-prototype`,
which is its own nested git repo with its own remote; the workspace root is a
separate git repo that holds `brain/`, `CLAUDE.md`, and `template/`. Commit
each change in the repo that owns the file.

## Steps

1. **Identify the active project.** Infer from this session which
   `projects/<name>/` the work was scoped to. Ask the user **only if you
   genuinely cannot tell**. If the session was workspace bootstrap (changes
   confined to `brain/`, `template/`, top-level config, or nothing under
   `projects/` was touched), classify it as not project-scoped and skip step 2
   without asking.

2. **Append project notes to `projects/<name>/CONTEXT.md` under "Lessons
   Learned".** Date-stamp entries `YYYY-MM-DD`. Include only what is useful
   inside this project: decisions made this session (with rationale), what
   broke and how it was fixed, and the top-of-mind next steps. This file lives
   inside the project repo, so it is committed by that repo.

3. **Append a global insight to `brain/lessons.md` only if it would help any
   future project, regardless of what is being built.** Use the entry template
   at the top of that file (date, project tag, short title, context, lesson,
   applies-to). Newest entry on top. Qualifies: tool discoveries, workflow
   patterns, mistakes to avoid, MCP gotchas. Does not qualify: anything tied to
   this project's domain, schema, or a specific bug. If a lesson is borderline,
   default to `CONTEXT.md` only. The bar for `brain/lessons.md` is "another
   project would benefit even though it has nothing in common with this one."

4. **Commit and push automatically. Do not ask.**
   - In the **project repo** (`projects/<name>/`): stage the project files you
     changed this session (including `CONTEXT.md`), commit with a descriptive
     message, and `git push`. Never use `git add -A` or `git add .`; stage
     explicit paths. Follow the project's own commit and deploy rules: if
     `server.py` or any `static/` asset changed, run `bash scripts/deploy.sh`
     rather than a bare commit.
   - In the **workspace root repo**: stage only the allowlisted paths
     `git add CLAUDE.md brain/ template/ tools/README.md` (each is a no-op when
     unchanged; anything already staged stays), then
     `git commit -m "<descriptive message>"` (skip the commit only when the
     index is empty), then `git push origin main` (push even when no new commit
     was made, in case prior commits are unpushed). **Never use `git add -A` or
     `git add .` here** and never expand the allowlist ad hoc.

5. **Report** the new commit hash(es) (if any) and the push result(s) for each
   repo touched, then end.

## Conventions

- No em dashes (`-`) or en dashes in any output, commit message, or file
  content.
- Plain language, short sentences, direct verbs.
- Nothing important stays local-only: code and configs go to GitHub, documents
  and notes go to the Drive vault.
