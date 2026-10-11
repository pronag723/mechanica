# Mechanica: 2D mechanics sandbox (working title)

A browser sandbox where users freely build 2D mechanics setups from parts (blocks, supports, pulleys, strings, springs, inclines…). They simulate them with **textbook-exact** numbers and read off the answers (accelerations, tensions, event times, extrema).

- Physics, architecture and roadmap: `docs/DESIGN.md`. This is the source of truth; section numbers like §3.4 refer to it.
- Visual language and UI rules: `docs/UI.md`.
- What has been built so far, deviations, follow-ups: `docs/PROGRESS.md`.
- Incremental work orders: `prompts/NN-*.md`. Each session implements exactly one prompt.

## Product principles
1. **Open-ended sandbox.** Users assemble any combination of the supported elements. Never write scenario-specific code (no "if this is an Atwood machine…"). Examples and presets are just documents. Unsupported combinations produce a clear diagnostic, never a crash and never silently wrong physics.
2. **Textbook-exact.** Idealized problems must match analytic answers. The relative error must be ≤ 1e-9 in uniformly accelerated phases (tolerance class `exact`) and ≤ 1e-7 for ODE-integrated motion such as springs, pendulums and curves (class `ode`).
3. **Report, don't guess.** If forces are indeterminate, the motion is undefined, no consistent mode exists, or something is unsupported, the engine emits a diagnostic. It never prints an arbitrary number.
4. **Regime changes are events.** Slack, lift-off, stick/slip, impacts and leaving a surface are located exactly. They are never smoothed.

## Architecture (each stage is a pure function and unit-tested)
`Scene document` (packages/scene: relational, zod-validated, versioned) → `layout resolver` → `compiler` → `ModelSpec` (packages/engine) → `simulate()` (Web Worker) → `Trajectory` (plain data) → views (apps/web).

## Repo layout
```
packages/engine   physics + numerics. Zero runtime dependencies. No DOM. Deterministic.
packages/scene    document schema, expressions, layout resolver, compiler → ModelSpec
apps/web          Vite + React editor/player (Tailwind v4, shadcn/ui on Radix, lucide icons)
tests/scenes      engine-level (engine/) and document-level (doc/) scenes + expected.json
tools/oracle      Python + SymPy: computes expected.json independently of the engine
docs/             DESIGN.md, UI.md, PROGRESS.md
prompts/          the prompt series
```

## Physics rules (non-negotiable; see DESIGN §3)
1. Internally: SI units, angles in radians, y axis up, gravity defaults to (0, −9.8). The UI shows degrees and Russian unit names.
2. Use maximal coordinates plus Lagrange multipliers (KKT system). λ is normalized so that tension, normal force and static friction come out in newtons, with tension ≥ 0 and normal force ≥ 0 meaning physical.
3. **The ODE right-hand side is smooth within a phase.** Never put `sign()`, `abs()`, `max(0,·)`, `if taut`, or anything similar inside it. Every non-smoothness is a guard function, and therefore an event.
4. Sliding friction modifies the contact's force column, with the sign fixed for the whole phase. Static friction is an extra constraint row.
5. Never use Baumgarte stabilization. Nonlinear constraints are handled by projection after each step.
6. The engine is deterministic: no `Math.random`, no `Date`. Iterate in a stable order (sorted by id).
7. Rotation is locked for every body until Phase 6, but angles and attachment offsets stay in the data model.
8. Every constraint and force carries provenance: `{ elementId, kind, symbol }`.
9. **Never loosen a tolerance or edit an expected value to make a test pass.** Find the bug, or stop and report the discrepancy.

## Code conventions
- TypeScript `strict`, ES modules, no `any` (use `unknown` and narrow it). Do not enable `noUncheckedIndexedAccess`, because it hurts numeric code.
- In engine and scene, prefer pure functions and plain serializable data over classes. Use `Float64Array` in hot paths and avoid allocating inside RHS evaluations.
- Put tests in `*.test.ts` next to the source. Put scene regression tests in `tests/`.
- Comments explain the math and physics (formulas, sign conventions, references), not the obvious code.
- Keep files small (≲ 400 lines), one concept per module.
- Scripts must run on Windows (PowerShell) and in Linux CI. No bash-only syntax in `package.json` scripts; write a Node script when needed.
- UI: every visible string goes through i18n (Russian by default, English as the second language). Follow `docs/UI.md` exactly. Do not invent new colors or spacing.

## Commands
- `pnpm install`
- `pnpm test`: all Vitest suites
- `pnpm typecheck` and `pnpm lint`. Run `pnpm format` to apply Prettier.
- `pnpm oracle`: regenerates `tests/scenes/expected.json`. Requires Python 3 and SymPy (`tools/oracle/requirements.txt`).
- `pnpm dev`: the web app (available from prompt 05).
- `pnpm e2e`: Playwright (available from prompt 05).

## Workflow for every prompt
1. Before planning, read the prompt file, this file, the DESIGN.md sections it references, `docs/PROGRESS.md`, and the README of each package you touch.
2. Stay inside the prompt's scope. Anything else you notice goes into `docs/PROGRESS.md` under "Follow-ups".
3. You are done when `pnpm typecheck`, `pnpm lint` and `pnpm test` are green (plus `pnpm e2e` for UI prompts), and `docs/PROGRESS.md` has a new entry. The entry records what was built, any deviation from DESIGN.md and why, known issues, and for the engine some performance numbers.
4. Keep each package README's public API section current. The next session relies on it.
5. Commit once at the end with the message given in the prompt.
