# kripto-digital-signature: instructions for the AI assistant

This repository keeps its project knowledge, rules, and every artifact in `.assist/`. Before doing any work, including anything outside `.assist/`:

1. Check the preflight mode in `.assist/_shared/project.md` (`required`, `light`, or `off`; default `required`). When the mode calls for it, run `node .assist/tools/preflight.js` and read its report. Before anything is pushed or published, always run it.
2. Read `.assist/README.md`, `.assist/orchestration.md`, and `.assist/status.md`.
3. Read `.assist/_shared/project.md`, then the acting role's `prompts/role.md` and `context.md` (roles are listed in `.assist/README.md`).
4. Read the skill that matches the task, its template, and the standards it references.
5. **Workflow first:** create the workflow doc for the flow you are about to change in `.assist/<role>/workflow/` (copy `_template.md`, `Status: planned`), or update it if one exists. Then follow the workflow approval mode in `.assist/_shared/project.md` section 2b (`review`: stop and wait for the owner's approval; `risk`: stop only when behaviour, cost, or risk changes; `direct`: continue). Do not start the work before the doc exists, or before approval when the mode requires it.
6. Say which role is acting and what the plan is.

Rules that always apply:

- Follow the role's skill order and templates. Put artifacts in the role's own folders and register IDs in `.assist/_shared/index.md`. Refer to other roles' artifacts by ID, never by path.
- Do not invent numbers, names, dates, or legal facts. Unknowns become open questions with an owner.
- Pending decisions belong to the project owner: ask, do not guess.
- Ask before installing software, changing global configuration, deleting or overwriting files, pushing, or publishing.
- Files under `.assist/` and `docs/` are written in English. Talk to the owner in the language they use.
- Everything in this repository, including `.assist/`, may become public: never write secrets, personal data, participant data, or local machine details (`.assist/publishing.md`).
- After work: correct the workflow doc to what was actually built (status, verified and not verified, update log), update `.assist/status.md`, run `node .assist/tools/check-registry.js` (and `node .assist/tools/preflight.js` when the mode requires it), and report plainly what was done and what was not verified.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
