# Prompt 00: Bootstrap the monorepo, tooling and the independent oracle

> Phase 0 · no dependencies · no physics code in this prompt

## Context
This is a new repo. It currently contains only `CLAUDE.md`, `docs/DESIGN.md`, `docs/UI.md` and `prompts/`. Read all of `CLAUDE.md` and DESIGN §7 (stack), §8 (test suite) and §9 (roadmap) before planning.

## Goal
Set up a clean pnpm monorepo with strict TypeScript, Vitest, ESLint, Prettier and CI. Add an **independent oracle**: a Python/SymPy script that computes the analytic expected values the engine will be tested against. Do this before any engine code exists, so the expectations can't be bent to fit the implementation.

## Build
1. **Git.** Run `git init` if the folder isn't a repo yet. Add `.gitignore` covering node_modules, dist, coverage, .vite, playwright-report, test-results, .venv, `__pycache__`, `*.local` and OS junk.
2. **Workspace.**
   - Root `package.json`: private, with a `packageManager` field pinning pnpm and `engines.node` set to the current Node LTS (≥ 22). Add `.nvmrc` too.
   - `pnpm-workspace.yaml` with `packages/*` and `apps/*`.
   - Root scripts: `test`, `typecheck`, `lint`, `format`, `oracle`. They must work in Windows PowerShell and in Linux CI.
3. **TypeScript.** `tsconfig.base.json` with `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` and `moduleResolution: "bundler"`. Do **not** enable `noUncheckedIndexedAccess`.
4. **`packages/engine`**, named `@mech/engine`:
   - `type: module`, and `exports` pointing at `./src/index.ts`. Workspace consumers use the source directly; there is no build step yet.
   - Its own `tsconfig.json` and `vitest.config.ts`.
   - `src/index.ts` exports `ENGINE_VERSION`, with one smoke test.
   - Zero runtime dependencies.
   - `README.md` with an empty "Public API" section.
5. **Lint and format.**
   - ESLint flat config with typescript-eslint (type-aware rules for `packages/*`).
   - Inside `packages/engine`, a rule that forbids `Math.random`, `Date` and `performance.now` (use `no-restricted-properties` / `no-restricted-globals`). Benchmarks in test files may opt out with a comment.
   - Prettier: printWidth 100, single quotes, trailing commas.
6. **CI** (`.github/workflows/ci.yml`, ubuntu-latest):
   - pnpm install with a frozen lockfile, then typecheck, lint, test.
   - Set up Python, install `tools/oracle/requirements.txt`, run the oracle, and fail if `git diff --exit-code tests/scenes/expected.json` shows changes.
7. **Oracle** (`tools/oracle/oracle.py` with `requirements.txt` pinning sympy):
   - Derive each answer **symbolically** in SymPy from Newton's laws or energy. Do not type in final numbers.
   - Substitute the given values and write `tests/scenes/expected.json` with stable key order and 15 significant digits. Format:
     ```json
     { "t01_atwood": { "a": { "value": 1.96, "class": "exact", "note": "a = (m1-m2)g/(m1+m2)" }, … }, … }
     ```
     `class` is `exact` (relative tolerance 1e-9) or `ode` (relative tolerance 1e-7).
   - Assert each result against the rounded numbers printed in DESIGN §8, to catch transcription errors in either place.
   - `pnpm oracle` runs it: `python tools/oracle/oracle.py`. Use `py` on Windows if `python` is missing, through a small Node wrapper script.
   - g = 9.8 everywhere. Scenes for Phase 0 and the extras needed by prompts 02–04:

   | id | Setup | Quantities |
   |---|---|---|
   | `t01_atwood` | m1 = 3, m2 = 2 kg, massless frictionless pulley, from rest | a = 1.96; T = 23.52; time for m1 to descend 1 m = 1.01015…; speed at that moment |
   | `t02a_table_frictionless` | M = 4 on table, m = 1 hanging, μ = 0 | a, T, N = Mg |
   | `t02b_table_kinetic` | same, μs = μk = 0.2 | a = 0.392, T = 9.408, N, F_fr = μMg |
   | `t02c_table_static` | same, μs = μk = 0.3 | at rest; F_fr = mg = 9.8 (not μN); T = 9.8; N; static limit μsN = 11.76 |
   | `t03_load_hits_floor` | M = 4, μ = 0.2, m = 2 hanging, bottom 0.5 m above floor, floor e = 0 | a = 1.96; T₁ = 15.68; impact time 0.714285…; impact speed 1.4; A's stop time 1.428571…; A's total path 1.0; T₂ = 0 |
   | `t14_two_strings` | m = 2 hung by two strings at 30° and 60° to the horizontal from fixed anchors | T₃₀ = 9.8, T₆₀ = 16.974… |
   | `t19c_bouncing_block` | block dropped from bottom height 1 m, e = 0.8, μ = 0 | comes to rest at t = √(2h/g)·(1+e)/(1−e) = 4.06578… |
   | `x01_block_slides_to_stop` | M = 1 on table, v₀ = 2 m/s, μs = μk = 0.2 | stop time = stop distance = 1.020408… |
   | `x02a_force_below_static` | M = 1, μs = 0.2, μk = 0.1, horizontal F = 1.5 N, from rest | stays; F_fr = −1.5 |
   | `x02b_force_above_static` | same with F = 2.5 N | slips at t = 0; a = 1.52 |
   | `x03_whirl_slack` | small block on a string L = 1 m from a fixed point, v₀ = 6 m/s horizontal at the bottom | slack when cos φ = (2gL − v₀²)/(3gL) = −0.557823…; speed there 2.33809…; height above the bottom point L(1 − cos φ) |
   | `x04_slides_off_table` | table top at 0.8 m, frictionless, block 0.2×0.1 at 2 m/s toward the edge | free-fall time √(2H/g) = 0.404061…; horizontal distance flown 0.808122…; speed along the floor afterwards 2.0 (e = 0, frictionless floor) |
8. **`docs/PROGRESS.md`** with these sections:
   - "Status" (a table of prompts 00–10 with ☐/☑)
   - "Log" (one dated entry per prompt)
   - "Deviations from DESIGN.md"
   - "Follow-ups"
   - "Known issues"

## Out of scope
Engine code beyond the smoke test, `packages/scene`, `apps/web`.

## Definition of done
- [ ] `pnpm install`, `pnpm typecheck`, `pnpm lint` and `pnpm test` are green on Windows.
- [ ] `pnpm oracle` produces `tests/scenes/expected.json`. A second run produces a byte-identical file.
- [ ] All oracle assertions against the DESIGN §8 values pass.
- [ ] The CI workflow is present and correct (you can't run it; just double-check it).
- [ ] PROGRESS.md is created with the 00 entry.
- [ ] Commit: `chore: bootstrap monorepo, tooling, CI and SymPy oracle`

## Report back
List the installed tool versions and anything I need to install (Python, sympy).
