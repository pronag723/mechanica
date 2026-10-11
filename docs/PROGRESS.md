# Progress

## Status
| # | Prompt | Done |
|---|---|---|
| 00 | Bootstrap: monorepo, tooling, CI, SymPy oracle | ☑ |
| 01 | Numerics: LU/QR, DOPRI5 with dense output, event location | ☑ |
| 02 | Model spec, constraints, instantaneous KKT solve | ☑ |
| 03 | Hybrid simulator: phases, guards, mode selection, probes, queries | ☐ |
| 04 | Impacts, slack/taut, Zeno, terminal events, CLI (Phase 0 exit) | ☐ |
| 05 | App shell and design system | ☐ |
| 06 | Scene document | ☐ |
| 07 | Editor | ☐ |
| 08 | String tool | ☐ |
| 09 | Simulation and timeline | ☐ |
| 10 | Answers | ☐ |

## Log

### 2026-10-11 · 00 Bootstrap
**Built**
- pnpm workspace (`packages/*`, `apps/*`), `packageManager: pnpm@12.11.2`, `engines.node >= 22.13`
  (the floor ESLint 10 and Vitest 5 need), `.nvmrc` = 22.
- `tsconfig.base.json`: `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noImplicitReturns`, `verbatimModuleSyntax`, `moduleResolution: bundler`, ES2023, no DOM lib.
  `noUncheckedIndexedAccess` is off. The root `tsconfig.json` covers root config files only.
- `@mech/engine`: `exports` → `./src/index.ts`, `ENGINE_VERSION` plus a smoke test, own `tsconfig.json`
  (`types: []`) and `vitest.config.ts`. Zero runtime dependencies.
- Root scripts: `test` (one Vitest run over the `packages/*` projects), `typecheck` (root config files,
  then `pnpm -r typecheck`), `lint` (`--max-warnings 0`), `format`, `format:check`, `oracle`.
- ESLint flat config: `@eslint/js` + typescript-eslint recommended everywhere, `recommendedTypeChecked`
  (project service) for `packages/**/*.ts`, eslint-config-prettier last.
- **Determinism rule** in `packages/engine`: `no-restricted-globals` (Date, performance) and
  `no-restricted-properties` (Math.random, globalThis.Date, globalThis.performance). Disabling them is
  itself an error outside `*.test.ts` (`@eslint-community/eslint-comments/no-restricted-disable`, which
  also catches a blanket `/* eslint-disable */`). Verified with throwaway probe files: every use in
  source is reported, and a benchmark in a test file opts out with
  `// eslint-disable-next-line no-restricted-globals -- benchmark timing`.
- Prettier: printWidth 100, single quotes, trailing commas. It skips `docs/`, `prompts/`, `CLAUDE.md`
  (hand-written layout) and `tests/scenes/expected.json` (written byte-for-byte by the oracle).
- `.gitattributes` forces LF, so the oracle's output is byte-identical on Windows and in CI.
- CI (`.github/workflows/ci.yml`, ubuntu-latest): pnpm install `--frozen-lockfile`, typecheck, lint,
  test; then Python 3.14, the pinned requirements, `pnpm oracle`, and a check that `expected.json` is
  tracked and unchanged.
- **Oracle** (`tools/oracle/`, see its README): 12 scenes, 52 quantities, all derived in SymPy from
  Newton's laws, energy or the impact law, with exact rational inputs evaluated at 40 digits and
  rounded to 15 significant digits. Three kinds of checks: each note's formula equals the derivation
  (at the givens and at perturbed givens); each regime hypothesis (stick/slip, taut/slack) is tested
  against its inequality; 46 rounded values printed in DESIGN §8 and prompt 00 match. All pass.
  - Repeated runs are byte-identical; a run under a second local Python with SymPy 1.13.1 also gave
    the identical file.
  - `x03.t_slack` (an integral, not in the prompt table) was cross-checked by integrating the
    pendulum ODE with mpmath `odefun`: it agrees to all 15 digits.
  - Keys added beyond the prompt table, because later prompts test them: `t03.a2`,
    `t19c.{t_impact1, v_impact1, v_rebound1, h_bounce1, t_impact2}`, `x01.{a, F_fr, N}`,
    `x02a.{a, N, F_fr_limit}`, `x02b.{F_fr, N}`, `x03.{h_slack, t_slack}`, `x04.vy_landing`.

**Tool versions:** Node 22.22.2, pnpm 12.11.2, TypeScript 6.0.3, Vitest 5.0.3, ESLint 10.12.0,
typescript-eslint 8.71.1, Prettier 3.9.10, Python 3.14.4, SymPy 1.14.0, mpmath 1.3.0. CI actions:
checkout v7, pnpm/action-setup v6, setup-node v7, setup-python v7.

**Version choices**
- TypeScript 6.0, not 7.0: typescript-eslint 8.71 supports TypeScript `< 6.1` only.
- `.nvmrc` pins Node 22 (maintenance LTS), which is what is installed locally. Node 24 is the active LTS.

**Performance:** no engine code yet. `pnpm test` takes about 0.3 s, and `pnpm oracle` about 5 s.

### 2026-10-11 · 01 Numerics
**Built** (`packages/engine/src/numeric/`, all exported from the package root; see the README's public API)
- `matrix.ts`: the `Matrix` type (row-major `Float64Array`) and helpers (create, get/set, matVec, matTVec,
  matMul, transpose, norms).
- `lu.ts`: LU with partial pivoting (LAPACK pivot convention), `luSolve` for many right-hand sides
  (in place allowed), and `luFactorInto` that refactors into existing storage without allocating.
  - `minPivotRatio = min_k |u_kk| / (|L|·|U|)_kk`: the share of each pivot that survived cancellation.
  - I first tried `min|u_kk| / max|a_ij|`. It was rejected for two reasons: random rank-(n−1)
    matrices gave "zero" pivots up to 1.4e-12, and a regular KKT matrix with a 10⁵ kg body
    gives ~1e-10 there.
  - The chosen ratio is invariant under row and column scaling. Measured on random matrices
    (asserted in `lu.test.ts`): singular ones give ≤ 5e-13, exactly singular KKT matrices give 0,
    and regular KKT matrices give a median of ~0.1 with outliers down to ~4e-10.
  - The default `singular` threshold is 1e-11. It is a heuristic; rank decisions use QR.
- `qr.ts`: Householder QR with column pivoting. Trailing column norms are recomputed every step
  instead of downdated, which costs nothing at these sizes and avoids cancellation.
  - `rank` uses the default tolerance `max(m, n)·eps·|r_00|`.
  - `completeOrthogonal` (a second QR of `[R11 R12]ᵀ`) underlies `leastSquaresMinNorm` and an
    orthonormal `nullSpace`.
- `dopri5.ts` + `dopri5-stages.ts` + `dopri5-hinit.ts`: a port of Hairer's `dopri5.f`.
  - It keeps Hairer's coefficients (checked against the source), FSAL, the error norm, the PI
    controller (β = 0.04, safety 0.9, factor ∈ [0.2, 10]) and the HINIT heuristic.
  - The end clamp stretches up to 1 % and lands on `tEnd` exactly; it never steps past it.
  - Failures are explicit: `max-steps`, `step-size-too-small`, `non-finite` and `end-reached`.
  - The caller drives it with `step()` and `restart(t, y, { h?, tEnd? })`.
- `dense.ts`: the `AcceptedStep` record and Hairer's CONTD5 dense output (`evalDense`, plus
  `evalDenseDerivative`). It returns y₀ and y₁ bit-exactly at the step ends.
- `roots.ts`: `findRoot` with Brent's method; tolerance `1e-13·max(1, |t|)`, at most 80 iterations;
  it returns the root and the bracket.
- `events.ts`: `locateEvents` samples each armed guard at both ends of the step and at k = 4 interior
  points, finds the earliest crossing, and returns it together with every guard crossing within
  `1e-12·max(1, |t|)`. Rising means `g_a < 0 ≤ g_b` and falling means `g_a > 0 ≥ g_b`, so a guard
  that starts at exactly 0 does not re-trigger. Disarmed guards are never evaluated.
- `ENGINE_VERSION` is now 0.1.0 (new public API). The seeded PRNG (mulberry32) lives in
  `packages/engine/tests/helpers/prng.ts`.
- Tests: 109 in `src/numeric/*.test.ts`. Besides everything the prompt lists, the tableau is checked
  against all 17 order-5 conditions (b), the 8 order-4 conditions (b̂, and b̂ is not order 5), and
  the order-4 conditions of the continuous weights b(θ). b(θ) is read off the production
  `fillDense`/`evalDense` code, so a typo in any coefficient fails a test.

**Results**
- y' = −y to t = 10, rtol 1e-10: relative error 1.6e-10, in 286 steps.
- Harmonic oscillator over 100 periods, rtol 1e-11 and atol 1e-13: phase error 1.7e-11, energy drift
  1.1e-9, in 33,369 steps. At rtol 1e-10 the drift is 1.1e-8, just over the 1e-8 bound, so the
  accuracy test uses 1e-11.
- Constant acceleration, worst relative error over 21 dense points per step:
  - 1.0e-15 in 5 steps (the error estimate is ≈ 0, so h grows 10× per step);
  - 2.7e-14 in 500 steps (hmax 0.01);
  - 1.7e-13 in 5000 steps (hmax 0.001; not asserted). Rounding accumulates linearly with the
    step count; see Follow-ups.
- **Arenstorf orbit** (T = 17.0652165601579625588917206249), max |y(T) − y(0)|:

  | rtol = atol | error | RHS evaluations | accepted | rejected |
  |---|---|---|---|---|
  | 1e-7 | 1.44e-3 | 1442 | 216 | 24 |
  | 1e-10 | 2.42e-6 | 5060 | 841 | 2 |
  | **1e-12 (asserted < 1e-7)** | **2.93e-8** | 12692 | 2113 | 2 |
  | 1e-13 | 2.75e-9 | 20114 | 3350 | 2 |
- Dense output at mid-step on y' = −y: the worst |error|/rtol is 3.9 (rtol 1e-4), 1.6 (1e-6) and
  3.9 (1e-8); the bound is 10.
- A projectile's ground hit through `locateEvents` is within 1e-12 relative of the analytic time.

**Performance** (Node 22.22.2, Windows 11)
- 100 oscillator periods at rtol 1e-10 (20,955 steps): 16–20 ms warm (the test runs once to warm
  up, then times), 35–40 ms cold (first run in a fresh process). Both are under the 50 ms budget.
  Plain Node, warm: about 14 ms (0.67 µs per step, including 6 RHS calls).
- Profiling findings that shaped the code:
  1. A `Float64Array(6n)` per accepted step took half the run time (over 64 bytes means an off-heap
     backing store), so step records are now slices of ~32 KB chunks: `{ data, offset }`.
  2. Vitest's SSR transform rewrites every imported binding into a property read on a module
     object, and the coefficients were read that way inside the stage loops. They are now
     module-local.
  3. The stage loops and the error norm are module-level functions, because the stepper's
     closure variables are context slots and are slow in the lower JIT tiers.
- The full engine suite takes about 1 s. Console numbers (Arenstorf, timing) are printed only with
  `pnpm vitest run packages/engine --silent=false`.

**Deviations from Hairer's dopri5.f** (not from DESIGN.md)
- No stiffness detection and no SOLOUT; the caller drives the stepper instead.
- `hmax` defaults to ∞ instead of |tEnd − t0|. The end clamp makes the two equivalent.
- An attempt with a non-finite error estimate (f undefined at a stage, or y₁ overflowed) is
  rejected with h ← h·facMin. If h then becomes negligible, the failure is `non-finite` rather
  than "step size too small".
- `maxSteps` counts attempts over the stepper's whole life; `restart` does not reset it.
- I chose Brent over Illinois for `findRoot`, as the prompt allowed.

### 2026-10-11 · 02 Model spec, constraints, instantaneous KKT solve
**Built** (`packages/engine/src/`, all exported from the package root; see the README's "Model" section)
- `spec.ts`: `ModelSpec`, plain JSON with `{ x, y }` vectors. Bodies (box or convex polygon, fixed
  `angle`, optional `velocity`), statics (half-plane or convex polygon, with a material), pair
  overrides, fixed pulleys (R ≥ 0), strings (`[end, …pulley vias, end]`, optional `restLength`),
  constant applied forces, options.
- `model/`: `compileModel(spec) → { model | null, diagnostics }`.
  - `validate.ts`: ids, numbers, shapes, references and route structure; nothing throws.
  - DOFs: x, y per body in id order. Constraints sorted by id: one per string, and one contact
    candidate `c:<body>:<static>:<face>` per body × support face.
  - At t₀ it checks: tangents exist; no segment < 1e-9·L*; no wrap within 1e-9 rad of 0 or 2π;
    the string is not longer than its rest length; no body overlaps a support (separating axes,
    tolerance 1e-9·L*).
  - Scene scales (L*, V*, F*, time) are defined here already, since the t₀ tolerances need L*.
- `geometry/string-path.ts`: one tangent formula for all four cases. With signed radii (ρ = ±R by
  wrap side, 0 at ends), D = c_B − c_A and Δρ = ρ_B − ρ_A, the direction is
  d = (ℓ·D − Δρ·n(D))/|D|² with ℓ = √(|D|² − Δρ²). Wraps are turning angles in the wrap sense, in
  [0, 2π). There is a non-allocating core (`traceString` on typed arrays) and a plain-object wrapper
  (`stringPath`, `stringGeometry`) for drawing.
- `constraints/`: `evalConstraint(c, t, q, v, row)` fills value, sparse J and J̇v into a reusable
  `ConstraintRow` without allocating.
  - String: J = +d₀ / −d_last on the end bodies; J̇v = −Σ(Δv × d)²/ℓ. The proofs are in comments.
  - Contact: g = n·p + depth − offset, with the support function precomputed (rotation is locked).
  - Also: `contactOverlap` (validity domain), `contactPoint`, `evalContactTangent`.
- `mode.ts`: `Mode { active, friction }`, `normalizeMode`, `modeKey`, `assertValidMode`.
- `kkt/`, `solve.ts`, `forces.ts`: `solveAccelerations(model, mode, t, q, v)` assembles
  [M −C; J 0]. Sliding contacts get the column (J_n − μk·s·J_t)ᵀ; stick contacts get a tᵀ row.
  - Fast path: pivoted QR shows rank(J) = rank(C) = #multipliers, then LU.
  - Otherwise: the KKT is scaled by exact powers of two, then a complete orthogonal decomposition
    gives the minimum-norm solution and the null space. That separates `STATICALLY_INDETERMINATE`
    (null vectors in λ only) from `MOTION_UNDETERMINED` (a null vector moves a body, or the system
    is inconsistent).
  - Output: `a`, `lambda`, `frictionLambda`, `indeterminate`, and a force breakdown whose sum per
    body is m·a.
- Scenes in `tests/scenes/engine/`: `t01_atwood`, `t02_table` (variants 2a/2b/2c as pair
  overrides), `t03_load_hits_floor`, `t14_two_strings` (variant `three_strings`).
  - Each file is an envelope `{ id, description, spec, variants? }`; the format is in that folder's
    README.
  - Coordinates are dyadic, so the t01–t03 segments come out **exactly** axis-aligned and the gaps
    exactly 0. The tests assert `===`.
- `ENGINE_VERSION` 0.2.0. 91 new tests (201 in total).

**Results**
- Instantaneous solves against `expected.json` (asserted ≤ 1e-12): every value is within
  2.8e-16 relative. t02c gives a = 0 exactly, and t14 gives |a| = 8.9e-16.
- Finite differences (central, 4-level Richardson) over 90 random string configurations in 15
  categories (worst errors):
  - gradient: 1.6e-12 (asserted 1e-9);
  - curvature by second differences: 2.7e-10 relative, limited by rounding (asserted 1e-9);
  - curvature as d/ds(J·v): 4.0e-13 (asserted 1e-10).
- Contact gaps for boxes and polygons at 6 angles each (half-planes and a polygon support):
  - the value matches a brute-force vertex minimum to ≤ 1.6e-15;
  - the gradient is within 1e-12, and the curvature is exactly 0.
- String lengths agree with an independent angle-based construction to 1e-13 relative.

**Performance** (Node 22.22.2, Windows 11, warm)
- `solveAccelerations` on t02b: 9.4 µs per call (2 bodies, 2 multipliers). This includes the two
  QR rank checks and the allocation of the output records.
- `compileModel` on t02b: 37 µs.
- The whole `pnpm test` run takes 1.5 s.

**Decisions** (the prompt left these open)
- Vectors are `{ x, y }` objects in the spec. `angle` and `velocity` are optional (default 0).
- Codes beyond the prompt's list: `INVALID_ID`, `INVALID_PARAMETER`, `SHAPE_INVALID`,
  `STRING_OVERSTRETCHED`.
- **Any compile error means `model: null`**, so a known-inconsistent scene is never simulated.
- A wrap angle of 0 at t₀ (a string that only touches a pulley) is an **error**, not a warning.
  Wraps are reduced to [0, 2π), so a string that leaves the pulley would silently "wrap all the
  way round".
- Contact provenance `elementId` is the body (forces are drawn on it); `elementIds` lists the body
  and the support.
- `frictionLambda` holds the signed friction along +t for **every** active contact: λ_t when it
  sticks, −μk·s·λ_n (derived) when it slips. `indeterminateFriction`, `status` and
  `ForceContribution.indeterminate` were added to the output.
- Every active contact needs a friction state, frictionless ones included (slip then adds nothing).
- The tangent formula uses |D|² − Δρ² directly rather than (|D| − |Δρ|)(|D| + |Δρ|). It is exact
  for dyadic inputs, which keeps textbook segments exactly axis-aligned, and the factored form is no
  better conditioned because |D| is itself rounded.
- Results avoid −0: tangents, normals and the zero friction of a μk = 0 contact are computed as
  `0 − x`.

## Deviations from DESIGN.md
- None. DESIGN §7 asks to check DOPRI5 "against the reference outputs". I checked the coefficients
  against Hairer's source and by order conditions, and the behaviour on his test problems
  (Arenstorf), but I did not diff step-by-step output against his Fortran driver: no Fortran
  toolchain here.
- **Redundancy with sliding friction (prompt 02).** DESIGN §3.2 says that when the active
  constraints are redundant, "the motion is still unique but the forces are indeterminate". That
  holds when the force columns are Jᵀ. With sliding friction they are (J_n − μk·s·J_t)ᵀ, and
  redundancy can leave the motion itself undetermined. Example: a block sliding on two coincident
  floors with different μk, where the split of N decides the friction and hence a_x. The solver
  therefore analyses the null space of the whole KKT matrix rather than only rank(J_A). Such cases
  report `MOTION_UNDETERMINED`; the rest report `STATICALLY_INDETERMINATE` as designed.

## Follow-ups
- **t19c rest time (prompt 04).** DESIGN §3.5 accepts the engine's Zeno cutoff within 1e-6 s of
  `t19c.t_rest`, but its class is `exact` (1e-9 relative, about 4e-9 s). The regression harness needs a
  per-key tolerance override for this key. Don't loosen the class for the other t19c keys.
- **CLI wall time (prompt 04).** `packages/engine/scripts/sim.ts` must measure wall time, but the
  determinism rule covers all of `packages/engine`, and the opt-out comment is rejected outside
  `*.test.ts`. Add a narrowly scoped override for `packages/engine/scripts/**` in `eslint.config.js`,
  or measure time outside the package.
- **apps/web (prompt 05).** Add `apps/*` to `projects` in the root `vitest.config.ts`, and extend the
  type-aware ESLint block to `apps/**/*.{ts,tsx}` with the DOM globals.
- **TypeScript 7.** Move to it when typescript-eslint supports it.
- **Node 24.** Bump `.nvmrc` to 24 (the active LTS) when convenient; CI follows `.nvmrc`.
- **KKT inside the RHS (prompt 03).** `solveAccelerations` allocates and runs two QR rank checks
  on every call (9.4 µs on t02b). In the ODE right-hand side and the λ(t) guards, run the rank
  analysis (`solveKkt`) once per mode. Then call `assembleKkt` (no allocation) and
  `luFactorInto` + `luSolve` on `sys.K`/`sys.rhs`; strings are `linear: false`, so re-assemble on
  each call. `forceBreakdown` allocates a trace per string; keep it out of hot paths.
- **Mode validation with indeterminate forces (prompt 03).** For a statically indeterminate mode
  the returned λ are the minimum-norm split, which can be negative even when a split with all
  λ ≥ 0 exists. "active ⇒ λ ≥ 0" must then be checked as feasibility over λ_p + null(C) (a small
  LP), not on the min-norm values.
- **Contact candidates (prompt 03).** Every body × face is a candidate, including faces that look
  away from the body (for a block on a table, the table's bottom face has a large negative gap).
  Candidates for activation need `contactOverlap > 0` and a small |gap|; a touchdown guard must
  combine "gap crosses 0 downward" with overlap > 0.
- **Wrap-angle guard (prompts 03–04).** `trace.wrap` is reduced to [0, 2π) and jumps at the cut.
  The "wrap → 0" guard needs a continuous branch, e.g. unwrap relative to the value at the phase
  start.
- **Static corners against body faces (prompt 04).** Contacts are body × support face only. A
  support polygon's vertex can therefore enter a body's face unnoticed (a block falling onto a
  wedge's apex, or sliding past a corner). The body–body separating-axis guard planned for
  `BODY_CONTACT_UNSUPPORTED` should also cover bodies against polygon supports, using
  `staticSeparation`.
- **Scene variants (prompt 04).** Scene files may carry `variants` (shallow spec overrides, e.g.
  `t02a/b/c`). The table-driven harness must expand them, keyed by the variant name in
  `expected.json`.
- **hmax vs. exactness (prompt 03).** Uniformly accelerated motion is exact to 2.7e-14 over 500
  steps but 1.7e-13 over 5000, because rounding in y ← y + h·Σbk accumulates. If the simulator caps
  hmax tightly for guard sampling, consider compensated (Kahan) summation of the state update.
  The `exact` class (1e-9) is far away either way.
- **Trajectory memory (prompt 03).** A step record shares a ~32 KB chunk with its neighbours, so
  keeping a few steps of a long run keeps their whole chunks alive. Copy steps out if a
  trajectory is thinned.
- **Tangential crossings (prompt 03).** A guard root of odd multiplicity ≥ 3 can end with
  `converged: false`; the bracket is still valid, so use it. Even-multiplicity tangencies are
  invisible to sign tests; bound `hmax`.
- **fast-check.** DESIGN §7 lists fast-check for property tests. The numerics tests use seeded
  loops instead; add fast-check with the first physics property tests.

## Known issues
- HINIT returns h = 0 when the scaled norm ‖f₀‖ overflows (|f|/atol > ~1e154), and the run then
  fails at once with `step-size-too-small` at t₀. Hairer's code does the same. SI-unit scenes are
  nowhere near it.
- μk > μs is accepted without a diagnostic. Mode selection may then find both stick and slip
  valid at v_t = 0 (`MODE_NOT_UNIQUE`, prompt 03).
- A pulley may appear twice in one route (not consecutively). The geometry handles it, but no test
  covers it.
- `pnpm oracle` uses the first `python` on PATH. On this machine another Python install with SymPy 1.13.1
  can shadow Python 3.14, depending on PATH order. The output is identical, and the oracle prints which
  interpreter it used and warns when SymPy differs from the pinned version.
