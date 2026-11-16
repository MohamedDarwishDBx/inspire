# CLAUDE.md: how we work in the Inspire repo

These rules apply to every session in this repository. This file is public. It holds process and engineering rules only: no secrets, no workspace names, no customer names, no personal paths. Put anything sensitive in your own local notes, not here.

## Start here: the requirements ledger

Before any work in this repo, read `app/docs/requirements/ledger.md`. It is the single list of what was asked, what shipped, and what is still open. Its hand-off section at the top lists every open row by area, so pick your work from there. Every change you make names the REQ row it serves, and every new ask becomes a REQ row before you start on it.

## 0. What this repo is

- Root: `inspire_installer.py`, `README.md`, `LICENSE`, and the dot files git reads at the root. Nothing else lives at the root.
- `app/`: the Inspire App (backend in `app/backend`, frontend in `app/frontend`, shared code in `app/shared`, installer scripts in `app/scripts`).
- `app/agent/`: the agent. The agent notebook is `app/agent/agent/dbx_inspire_ai_agent.ipynb`. A copy is bundled into the App at `app/dbx_inspire_ai_agent.ipynb`. The two copies must be byte-identical.
- The agent runs on Databricks Serverless. It reads Unity Catalog metadata and writes a use-case catalog. It tracks state in tables under one Inspire database.

## 1. Branches and releases

- `dev` is the integration branch. Work lands on `dev` with a commit, not through a long-lived lane branch. Before each push to `dev`: the merge is clean, the leak gate passes, the notebook parses, the notebook is under the size limit, and the targeted tests pass.
- `main` moves only when the product owner accepts a release. Then `main` is fast-forwarded to the accepted `dev` commit, the release tag goes on it, and the release is marked latest. Never push to `main` otherwise.
- Outside contributors work from their own fork and open pull requests into `dev`.
- Only one release candidate is published per version. Do not publish intermediate RCs. Pre-releases are built from `dev` and proven before the owner sees them.
- Keep `rerere` disabled. A merge conflict is resolved by reading both sides, not by a recorded resolution.

## 2. Requirements ledger (the single source of truth for what we owe)

**`app/docs/requirements/ledger.md` is the single source of truth for every ask.** Nothing else tracks what is owed. Chat history, handover notes and memory are not the ledger.

The rules:

1. **Every ask becomes a REQ row before any work starts.** An ask is any instruction that changes product behaviour, copy, a gate, a release or a deploy. A duplicate ask links to the existing REQ. A defect found in a run becomes a row too, with the run evidence in the Evidence column.
2. **Row fields:** id (`REQ-nnn`, or `D-…` for a coordinator decision), asked date (UTC), the ask in the owner's words (paraphrase marked as such), state, lane or branch, evidence, and the live acceptance check.
3. **States:** OPEN (not started), BUILDING (a lane and worktree are on it), LOCAL (on a branch, tests green, not on `dev`), DEV (on `dev`, not live-walked), DONE (live-walked on an installed build), BLOCKED (named blocker), OUT and SUPERSEDED (kept with the reason).
4. **DONE means all three:** the code is on `dev` (a SHA), its tests are green, and it was walked live on an installed build (the build, the URL, and what was clicked are in the evidence). A text-presence check is not a walk.
5. **A release candidate is cut only when every in-scope REQ is DONE.** The scope list names the RC2 ids and the HANDOFF ids. A REQ that is not DONE does not ship in the RC; it moves to HANDOFF or stays in scope and blocks the cut.
6. **Every builder brief names the REQ ids it owns and asks for a report per REQ.** A report that does not name a REQ cannot close it.
7. **The publisher produces the public file.** The coordinator keeps the working copy outside the repo. After every change to the working copy, run:

   ```
   python3 app/scripts/ledger_publish.py --ledger <working copy> --scope <scope file>
   python3 app/scripts/ledger_publish.py --check
   ```

   The publisher is deterministic and sanitizes every row: 12-plus digit numbers become `<id>`, workspace hosts and non-public URLs are removed, emails become `<email>`, home paths become generic, customer names become "a customer", scratch App and catalog names become generic, and insults are rewritten and marked "(paraphrased)". Never hand-edit `app/docs/requirements/ledger.md`. Change the working copy and re-run.
8. **Hand-off.** The ledger opens with a Hand-off section that lists the HANDOFF rows and the in-scope rows that are not DONE, grouped by area. Whoever picks the work up starts there. To take a row, add a lane line to its row, change its state to BUILDING with the owner, and cite the REQ id in every commit and brief.
9. **One coordinator.** Exactly one session coordinates a project at a time. After a resume or an interruption, check for another live session on the same work before dispatching anything. Two coordinators on one ledger produce two versions of the truth.

A status report about the ledger is built from the ledger rows, the lane reports and git. It is never built from memory.

## 3. How we test

There are four local suites. Each one has a CI job with the same command.

| Suite | Where it runs | Command |
|---|---|---|
| python | `app/agent/tests` (unit tests, one file per REQ or version) | `python -m pytest -q -p no:cacheprovider --timeout=600 <files>` from the repo root |
| backend | `app/backend/test` (Node's built-in runner) | from `app/`: `node --test backend/test/*.test.js` |
| shell | the agent's web shell in `app/agent/agent/app_shell/web` | from that folder: `npm ci`, then `npm run -s build`, then `node --test --test-timeout=120000 'test/*.test.mjs'` |
| frontend | `app/frontend/test/ui` (browser tests on the built App) | from `app/frontend`: `npm ci`, then `node --test --test-global-setup=test/ui/prebundle.mjs 'test/ui/*.test.mjs'` |

The installer has its own pytest folder at `app/installer/test`. Run it when the installer changes.

Rules for running them:

- **Slot discipline.** At most three test files in a targeted run. Only one xdist suite runs at a time on a shared machine. Never pass more than two workers from an agent shell. Full suites run on CI; locally, run the files your change touches. The coordinator's slot wrapper is the entry point for local runs. It wraps the plain command above.
- **Never kill by pattern.** Stop only the process you started, by the PID you noted when you started it.
- **Check the machine first.** Look at the load before a local suite. If the load is high, wait for it to drop instead of starting another suite.
- **Fail-pre, pass-post.** Every defect gets a test that fails on the broken behaviour before the fix and passes after it. A test that cannot fail is not a test. Each guard test has a must-fail case (the planted bad input is caught) and a must-keep case (the good input passes).
- **No tautologies.** A filter or branch must be able to say no. Do not ship a check whose two branches do the same thing.
- **Use the real behaviour.** Prefer a test that runs the code path over a grep for a string. A presence check proves that text exists, not that it works.

### Notebook and generated files (run after every merge and every change to the agent)

- The notebook parses cell by cell with `ast.parse`. The CI job `notebook parses and both copies are identical` shows the command.
- The two notebook copies are identical (`cmp`).
- The notebook is under 6,000,000 bytes. The CI job prints the size of each copy.
- The bundled notebook is current: run `node scripts/bundle-agent-notebook.mjs` from `app/` and check that the diff is empty.
- The embed check: run the embed script in check mode from `app/agent`. Write mode regenerates the embedded shell; check mode fails if the committed copy is stale.
- The frontend build: `npm run build` in `app/frontend` must pass after any UI change.
- After a merge, regenerate every generated file above and commit the regenerated output in the merge commit. Never commit a merge with a stale generated file.

### Live walks (the only proof that counts for DONE)

A live walk runs on a scratch App on an installed build, not on a local server. The walk checks:

- the served assets: the App serves the build you think it serves (check the asset hash or version on the page);
- two viewports: 1440x900 and 1280x800;
- the browser console: no errors, and every page loads without 4xx or 5xx responses;
- one screenshot per row checked, saved with the row's REQ id;
- one RAG per row (green = passes on the installed build, amber = partly or unproven, red = fails);
- the walk runs on a build made after the install, so the installed build is the one under test.

Record the build, the URL, the viewports, and the result per row in the ledger's evidence column. A walk on a local server is not a walk for DONE.

### Merge discipline

- `rerere` is disabled. Resolve conflicts by reading both sides.
- After a merge, regenerate the generated files (section above), run the four suites that the change touches, and push only when the merge is clean.
- Never bypass a git hook. If a hook fails, fix the cause.
- Do not force-push `dev` or `main`.

## 4. Release flow

1. Build the release from `dev`. Stamp the release tag into the installer.
2. Publish one pre-release. Do not publish intermediate RCs.
3. Install the pre-release on a scratch workspace through the installer. Run the live walks for every in-scope REQ on that install.
4. Mark the release latest and move `main` only after the owner accepts it. Until then, `main` and the latest-release link are untouched, and `dev` is never reset or rewritten.
5. The release check downloads every release file through the pre-release links, verifies each sha256 against `manifest.json`, and runs the installer from a fresh folder.

## 5. Deploy and install

- The App is deployed only through the installer. Do not deploy a source folder directly, do not create the App from git, and do not run a local server for anyone to check. A local server is for automated tests only.
- Before an install, confirm no job started by the App's service principal is running. The install restarts the App.
- After each install, prove the setup wizard is skipped before the App is shown to anyone: the App's defaults endpoint must report that the setup wizard is skipped. Then open the installed App URL.
- Every release carries the same four files: the installer, the App zip (with the agent notebooks inside), the assets tar, and `manifest.json` with the version, size and sha256 of each file.
- The installer is pinned to its own release tag. It reads only the release-tag download links, never the "latest" link. It refuses a manifest whose tag or version differs from its own, and it refuses local files from another version. It never mixes versions and never uses a partial download.
- Runs use the installed copy of the assets. Nothing installs packages at run time. Assets carry a build for each CPU type, and a missing build is downloaded from the pinned release when the run has internet.
- The only instruction for a user is: download the installer from the latest release, import it into a workspace folder, and run it. Everything else is in the installer's output.

## 6. Engineering rules

These are the working rules. Each one came from a real defect or audit.

1. **Serverless first.** Code must run on Databricks Serverless with no `cache`, `persist`, `unpersist`, or `SparkContext`. Do not write to `/tmp` and expect it to survive a run.
2. **Root cause, not symptom.** When asked to fix a problem, find the cause and fix it there. Then sweep the whole tree for the same defect class and fix every site in the same change. Report the class, the sweep command and the closing grep.
3. **Search before you write.** Before any new helper, grep for the concept name, the function prefix and the table name. Read the top three matches. Extend existing code when it covers most of the need. Two implementations of one concept is a bug.
4. **User input wins.** Any explicit user input (a widget, a configuration value, a directive) outranks every heuristic, score and model opinion. A heuristic that overrides a user input is a critical bug. Every validator rejects a proposal that breaks a user input, and every heuristic checks the input before it fires.
5. **User-named items are protected.** Names the user lists (domains, use cases, products) appear in the output verbatim. The pipeline may add items; it may never remove, rename or substitute a named one.
6. **Single-digit version segments.** Every segment of a version is one digit, 0 to 9. A segment at 9 rolls to 0 and carries one to the left. Notebook and release names follow the version without dots.
7. **Industry-agnostic code.** No customer, industry, business or workspace names in code, prompts, schemas, fixes or tests. Read environment values from widgets, the metastore or the runtime. Test with neutral fixtures.
8. **Prompt rules are structural.** A prompt rule must not carry an industry example. Every prompt tells the model that the user's explicit input wins over the prompt's guidance.
9. **Honest definition of done.** A fix is done when the code is on disk, it parses, a test exists that fails on the old behaviour and passes on the new one, a call site uses it, the commit is on `dev`, the push succeeded, and the installed build shows the change. Anything less is "in progress", and it is reported as such.
10. **No dead code framed as a fix.** A helper ships with its first call site in the same change.
11. **Regression report after every delivery.** Before you hand a change back, list every regression you can find, its severity, and its root-cause fix.
12. **Critique the approach.** When a task is handed to you, name the assumptions and any simpler route. If the requested route is the right one, follow it.
13. **Minimal, surgical edits.** Touch only what the request needs. Match the style around the change. Mention unrelated dead code; do not delete it in the same change.
14. **Verify before you claim.** Use a grep, a test or a live check with a file and line before saying something is shipped, wired or fixed.

## 7. Live monitoring of a run

- Before you submit a test job, pass a fresh session id so the run's state is isolated from older runs.
- Read the job state and the run log together. A run is green only when its state, its log and its outputs agree.
- Poll the run every ten seconds in a background loop. A quiet log is not a hang: check the job's life-cycle state and the last stage that emitted before you call it dead or kill it.
- Read every line of the log that is new. Do not summarize from the first line.
- If the log is empty, check that the run's log path is the one the run writes, then check the job state. Do not conclude from an empty file.
- Keep monitoring evidence on disk next to the run id, so the next session can pick it up.

## 8. Use-case quality audit (summary)

After a generation run, audit the output in four stages: the live log, the portfolio shape of the output (counts, distribution by theme, the top and bottom of the ranking), a per-item spot check of at least five items, and a cross-run comparison. Score every item against the agreed gate list. A verdict of BLOCKED needs a named cause. Report the honest score, not the best-looking one. The full gate list lives with the team's quality notes, not in this file.

## 9. Interruptions

If a session is cut in the middle of a step, resume from durable state: the ledger, the git branches and uncommitted diffs, the live runs, and the subagent status. Re-check anything cut mid-way before re-running it. Never run a launch twice. Restart the monitoring loop straight away if runs are live.

## 10. Reporting

- Lead every status line with a state marker: a green, amber or red mark for pass, unproven or fail. Use numbers: counts, percentages with their denominators, run ids and SHAs.
- Each status update names what is not being worked on, so nothing is left unsaid.
- Escalate with one line: the next action and what it waits on.
- Do not use "shipped", "landed" or "wired" without a SHA and a file and line that prove it.
- Do not write customer-facing text in the repo's public files as if the reader were a prospect. Write to the practitioner.
- Do not put personal details, customer names, account identifiers or workspace identifiers in the repo or in commit messages.

## 11. Commits and history

- Commit messages start with a type: `agent:`, `app:`, `docs:`, `test:`, `infra:`, `rules:`, `hotfix:` or `chore:`. Name the REQ ids the commit owns.
- Every commit that claims delivered work is pushed, then checked with `git branch --contains <sha>` and `git ls-remote` on the branch.
- Never run `git reset --hard` against a remote when local has commits that are not pushed.
- Never commit generated files that are stale. Never commit secrets, tokens or local paths.
