# @mech/engine

Physics and numerics for the mechanics sandbox: the model, constraints, the KKT solve, DOPRI5 with dense output, events, mode selection and impacts (see `docs/DESIGN.md` §3).

- Zero runtime dependencies. No DOM, no Node APIs in `src/`.
- Deterministic: no `Math.random`, `Date` or `performance.now` (enforced by ESLint). A benchmark inside a `*.test.ts` file may opt out with `// eslint-disable-next-line no-restricted-globals -- benchmark timing`; the opt-out is rejected anywhere else.
- Consumed as TypeScript source: `exports` points at `./src/index.ts`, and there is no build step.

## Scripts

- `pnpm --filter @mech/engine test` runs this package's Vitest suite (`src/**/*.test.ts`, `tests/**/*.test.ts`).
- `pnpm --filter @mech/engine typecheck`

## Layout

```
src/numeric/   generic numerics, no physics (prompt 01)
  matrix.ts      Matrix type and helpers           lu.ts      LU with partial pivoting
  qr.ts          pivoted QR, rank, min-norm LS, null space
  dopri5.ts      the stepper (controller, API)     dopri5-stages.ts   coefficients, stages, error norm
  dopri5-hinit.ts  initial step heuristic          dense.ts   AcceptedStep and dense output
  roots.ts       Brent root finder                 events.ts  guards and event location
tests/helpers/ test-only helpers (seeded PRNG)
```

## Public API

Everything below is exported from the package root (`@mech/engine`).

`ENGINE_VERSION: string`: the version of the public API and the Trajectory format (`0.1.0`).

### Linear algebra (`numeric/linalg`)

Matrices are plain data: `{ rows, cols, data: Float64Array }`, row-major, entry (i, j) at `data[i·cols + j]`. Vectors are `Float64Array` (inputs accept any `ArrayLike<number>`).

- Construction and access: `createMatrix(rows, cols)`, `matrixFromRows(number[][])`, `matrixToRows(A)`, `identity(n)`, `getEntry`, `setEntry`, `copyMatrix`, `transpose`.
- Products: `matVec(A, x, out?)` (A·x), `matTVec(A, x, out?)` (Aᵀ·x), `matMul(A, B)`.
- Norms: `normMax`, `normInf`, `norm1`, `normFro`, `vecNorm2`, `vecNormInf`; `EPS = Number.EPSILON`.
- **LU with partial pivoting** (handles zero diagonal entries, e.g. the KKT matrix `[M −Jᵀ; J 0]` with massless coordinates):
  - `luFactor(A, { singularTol? })` returns `{ n, lu, piv, singular, minPivotRatio }`. `piv` uses the LAPACK convention (row k was swapped with row `piv[k]`).
  - `minPivotRatio = min_k |u_kk| / (|L|·|U|)_kk` ∈ [0, 1]: how much of each pivot survived cancellation. It is invariant under row and column scaling (a 10⁵ kg body beside a 1 g body is fine). `singular` means `minPivotRatio ≤ DEFAULT_SINGULAR_TOL = 1e-11`. It is a heuristic; for rank decisions use `rank`.
  - `luSolve(f, b, out?)` solves A·x = b, reusing the factorization; `out` may be `b` (in place). It throws on a singular factorization.
  - No allocation: `createLU(n)` and `luFactorInto(A, f, opts?)`.
- **Householder QR with column pivoting**, A·P = Q·R:
  - `qrFactor(A, { pivoting? })` returns `{ m, n, qr, tau, perm }`; also `applyQt`, `applyQ`, `formQ` (thin Q) and `extractR`.
  - `rank(A, { tol? })` and `qrRank(f, { tol? })` count the |r_kk| above `tol`; the default is `max(m, n)·eps·|r_00|`.
  - `leastSquaresMinNorm(A, b, { tol? })`: the minimum-norm least-squares solution, via a complete orthogonal decomposition (`completeOrthogonal(A)`).
  - `nullSpace(A, { tol? })`: an orthonormal null-space basis, as the columns of an n × (n − rank) matrix.

```ts
// K = [M −Jᵀ; J 0] (M may have zero diagonal entries), rhs = [f; −J̇v]
const lu = luFactor(K);
if (lu.singular) throw new Error('a massless element is not determined');
const x = luSolve(lu, rhs); // accelerations, then multipliers
if (rank(J) < J.rows) console.warn('redundant constraints: forces are indeterminate');
```

### DOPRI5 with dense output (`numeric/dopri5`, `numeric/dense`)

This is a port of Hairer's `dopri5.f`: Dormand–Prince 5(4), FSAL, the mixed error norm `atol_i + rtol·max(|y₀_i|, |y₁_i|)`, a PI controller (β = 0.04, safety 0.9, factor ∈ [0.2, 10]), and the HINIT initial step. The caller drives it one accepted step at a time.

- `createDopri5(f, t0, y0, opts?)` returns a `Dopri5Stepper`.
  - `f(t, y, dydt)` writes into `dydt` (`OdeRhs`).
  - Options: `rtol` (1e-10), `atol` (1e-12, a scalar or per component, > 0), `tEnd` (default ∞; it fixes the direction, and the last step lands on it exactly), `hmax` (∞), `hmin` (0), `h0` (0 means HINIT), `maxSteps` (100 000 attempts over the stepper's life), and `safety`, `facMin`, `facMax`, `beta`.
- `stepper.step()` returns `{ ok: true, step }` or `{ ok: false, reason, message, t }`. `reason` is one of `'max-steps' | 'step-size-too-small' | 'non-finite' | 'end-reached'`. Rejected attempts are retried inside `step()`, and the stepping loop does not allocate.
- `stepper.restart(t, y, { h?, tEnd? })` drops the FSAL derivative and resets the controller (HINIT runs unless `h` is given). Use it at events, after changing the state or the mode the RHS reads.
- Read-only state: `stepper.t`, `stepper.y` (a live buffer; copy it), `stepper.h`, `stepper.tEnd`, `stepper.done`, and `stepper.stats` (`nfev`, `nsteps`, `naccept`, `nreject`).
- `AcceptedStep` is `{ n, t0, t1, h, data, offset }`. The step owns `data[offset, offset + 6n)`: Hairer's coefficients r₁…r₅, then y₁. The stepper slices `data` from shared chunks.
  - `evalDense(step, t, out)` evaluates y(t) for t in [t0, t1]. It is 4th order and returns y₀ and y₁ bit-exactly at the step ends.
  - `evalDenseDerivative(step, t, out)` evaluates y′(t); it equals f at the step ends.
- `hairerInitialStep(…)` (HINIT) and `DOPRI5_TABLEAU` (`{ c, a, b, e, d }` arrays) are exported for tests and tooling.

```ts
const stepper = createDopri5(
  (t, y, dy) => {
    dy[0] = y[1];
    dy[1] = -9.8;
  },
  0,
  [1.25, 3.1],
  { tEnd: 2, hmax: 0.05 },
);
for (let r = stepper.step(); r.ok; r = stepper.step()) {
  const y = evalDense(r.step, (r.step.t0 + r.step.t1) / 2, new Float64Array(2));
}
```

The dense output reproduces every uniformly accelerated motion exactly, up to rounding: the error was ≤ 3e-14 relative over 500 steps and 1.7e-13 over 5000.

### Root finding and events (`numeric/roots`, `numeric/events`)

- `findRoot(g, ta, tb, ga, gb, { tol = 1e-13, maxIterations = 80 })` uses Brent's method. It returns `{ t, lo, hi, gLo, gHi, iterations, converged }`, with the final bracket ≤ `tol·max(1, |t|)` wide. An exact zero at an end returns that end. It throws without a sign change or when g returns NaN. Roots of odd multiplicity ≥ 3 converge linearly and may end with `converged: false`, but the bracket is still valid.
- A `Guard` is `{ id, direction: 'rising' | 'falling' | 'any', armed, fn(t, y) }`, where `y` is the dense state at t (a scratch buffer).
- `locateEvents(step, guards, { samples = 4, simultaneityTol = 1e-12, rootTol = 1e-13, maxIterations = 80, scratch? })` returns `{ t, hits }` or `null`.
  - Each armed guard is sampled at both ends of the step and at `samples` interior points, so two sign changes inside one step are caught.
  - Crossing rules: rising means `g_a < 0 ≤ g_b`, falling means `g_a > 0 ≥ g_b`. A guard that starts at exactly 0 and moves away does not fire.
  - It returns the earliest crossing in the integration direction, with every guard crossing within `simultaneityTol·max(1, |t|)` of it. Hits are sorted by id (their times differ only by rounding), and each is `{ id, index, t, lo, hi, crossing, converged }`.
  - Disarmed guards are never evaluated. A guard returning NaN throws.

```ts
const ground: Guard = { id: 'B:floor', direction: 'falling', armed: true, fn: (_t, y) => y[0] };
const event = locateEvents(step, [ground]);
if (event) stepper.restart(event.t, evalDense(step, event.t, new Float64Array(2)), { h: step.h });
```
