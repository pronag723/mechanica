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
src/numeric/     generic numerics, no physics (prompt 01)
  matrix.ts        Matrix type and helpers           lu.ts      LU with partial pivoting
  qr.ts            pivoted QR, rank, min-norm LS, null space
  dopri5.ts        the stepper (controller, API)     dopri5-stages.ts   coefficients, stages, error norm
  dopri5-hinit.ts  initial step heuristic            dense.ts   AcceptedStep and dense output
  roots.ts         Brent root finder                 events.ts  guards and event location
src/spec.ts      ModelSpec, the engine's JSON input (prompt 02)
src/diagnostics.ts, src/ids.ts    the diagnostic type and codes; id order, contact ids
src/geometry/    shapes.ts (convex shapes, support features), string-path.ts (tangents, wraps, length)
src/model/       compileModel: validate, compile, strings, contacts, scales, forces, types
src/constraints/ row.ts (ConstraintRow), string.ts, contact.ts, index.ts (evalConstraint)
src/mode.ts      Mode and friction states
src/kkt/         assemble.ts (layout and KKT assembly), solve-system.ts (LU fast path, rank analysis)
src/forces.ts    force breakdown per body           src/solve.ts   solveAccelerations
tests/           instantaneous.test.ts (scenes against expected.json)
tests/helpers/   test-only helpers: seeded PRNG, finite differences with Richardson extrapolation,
                 scene loading, an angle-based reference construction of string paths
```

The scenes live at the repository root: `tests/scenes/engine/*.json` (format in its README) and the
oracle's `tests/scenes/expected.json`.

## Public API

Everything below is exported from the package root (`@mech/engine`).

`ENGINE_VERSION: string`: the version of the public API and the Trajectory format (`0.2.0`).

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

## Model (prompt 02)

### Conventions

- SI units, angles in radians, **y up**, gravity usually `{ x: 0, y: -9.8 }`.
- Vectors are `{ x, y }` objects in the spec; the state uses `Float64Array`s `q` (positions) and `v`.
- **DOF layout:** `x, y` per body, bodies sorted by id (`model.dofs`, `body.dofX/dofY`). Phase 6
  will add θ per body and Phase 2 φ per massive pulley; always go through the index map.
- **Ids** are unique across all elements, non-empty, without `':'`. Iteration order is always by id
  (`compareIds`: UTF-16 code units, not locale-aware).
- **Constraints** are scalar `g(q) ≥ 0` (all unilateral in Phase 0) with multiplier `λ ≥ 0`;
  `J = ∂g/∂q`; `curvature = J̇·v` (+ time terms, none yet), so `g̈ = J·a + curvature`.
- **Strings:** `g = L₀ − L(q)`; `λ` = tension (N). On a body end, `J` is the unit vector along the
  string pointing _towards_ the rest of the route, i.e. the direction in which the string pulls.
- **Contacts:** the face is the line `n·x = offset` with **outward** unit normal `n` (out of the
  support). `g = n·p + depth − offset` = signed distance of the body's lowest vertex (in direction
  `n`) from the line; `λ` = normal force (N), acting along `+n` on the body.
- **Tangent:** `t = (n_y, −n_x)`, `n` turned clockwise, so `(t, n)` is right-handed like `(x̂, ŷ)`:
  a floor (`n = ŷ`) has `t = x̂`; an incline rising to the right has `t` pointing up the slope.
  Polygon faces: face `i` runs from vertex `i` to vertex `i + 1` of the counter-clockwise polygon;
  `t` is _opposite_ to that edge direction.
- **Tangential velocity** `v_t = t·v_body`. **Friction states:** `slipPos` ⇔ sliding along `+t`
  (`v_t > 0`), kinetic friction `μk·N` along `−t`; `slipNeg` is the mirror image; `stick` adds the
  row `J_t·a = −J̇_t·v` whose multiplier `λ_t` is the **signed static friction along `+t`**.
- **Wrap:** `cw`/`ccw` is the sense in which the string turns around a pulley when its route is
  traversed from its first end to its last. `ccw` keeps the pulley's centre on the left of the
  direction of travel. Reversing a route flips every wrap.

### ModelSpec (`spec.ts`)

Plain JSON, world coordinates. An annotated example (the t02 table scene, abridged):

```jsonc
{
  "gravity": { "x": 0, "y": -9.8 },
  "bodies": [
    {
      "id": "A",
      "symbol": "A",
      "mass": 4, // kg, ≥ 0
      "shape": { "kind": "box", "w": 0.5, "h": 0.25 }, // or { kind: 'convexPolygon', vertices (local, CCW) }
      "angle": 0, // optional, rad, constant (rotation is locked)
      "position": { "x": -2, "y": 0.125 }, // the shape's local origin (a box's centre)
      "velocity": { "x": 0, "y": 0 }, // optional, default 0
    },
  ],
  "statics": [
    {
      "id": "table",
      "kind": "convexPolygon", // or { kind: 'halfPlane', point, normal }
      "vertices": [
        { "x": -3, "y": -1 },
        { "x": 0, "y": -1 },
        { "x": 0, "y": 0 },
        { "x": -3, "y": 0 },
      ],
      "material": { "muS": 0.2, "muK": 0.2, "restitution": 0 },
    },
  ],
  "pairOverrides": [{ "a": "A", "b": "table", "muS": 0.3 }], // optional, per body–support pair
  "pulleys": [{ "id": "pulley", "center": { "x": 0.125, "y": 0 }, "radius": 0.125 }], // fixed, massless
  "strings": [
    {
      "id": "string",
      "symbol": "T",
      "route": [
        // [end, …vias, end]
        { "kind": "body", "body": "A", "anchor": { "x": 0.25, "y": 0 } }, // anchor is body-local
        { "kind": "pulley", "pulley": "pulley", "wrap": "cw" },
        { "kind": "fixed", "point": { "x": 0.25, "y": -2 } }, // or a world point
      ],
      "restLength": 3.0, // optional; default = the length at t₀ (taut)
    },
  ],
  "appliedForces": [{ "id": "F", "body": "A", "force": { "x": 10, "y": 0 } }], // optional, constant
  "options": { "horizon": 1, "rtol": 1e-10 }, // also atol?, maxEvents?
}
```

- A half-plane's solid is `{ x : normal·(x − point) ≤ 0 }`; `normal` points out and is normalized.
- Polygons (bodies and supports) must be counter-clockwise and strictly convex (no collinear
  vertices).
- The friction of a body–support pair is the support's material; `pairOverrides` (either id order)
  replace individual fields, later entries winning.

### Diagnostics (`diagnostics.ts`)

`Diagnostic = { code, severity: 'error' | 'warning' | 'info', elementIds, params, message }`. The UI
localizes by `code` and `params`; `message` is English for developers. `hasErrors(list)`.

| code                        | when                                                                                                             | severity | params                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| `INVALID_ID`                | empty, contains `':'`, or duplicate                                                                              | error    | `kind, reason`                     |
| `INVALID_PARAMETER`         | non-finite number, mass < 0, box w or h ≤ 0, μ < 0, e ∉ [0, 1], horizon ≤ 0, …                                   | error    | `field, reason`                    |
| `SHAPE_INVALID`             | polygon with < 3 vertices, clockwise, or not strictly convex                                                     | error    | `reason`                           |
| `UNKNOWN_REFERENCE`         | a route, applied force or pair override names a missing element (or one of the wrong kind)                       | error    | `field, ref, expected`             |
| `STRING_ROUTE_INVALID`      | `tooShort`, `endNotEnd`, `viaNotPulley`, `repeatedPulley`, `noBody`, `wrapUnknown`                               | error    | `reason`                           |
| `STRING_SEGMENT_DEGENERATE` | a segment shorter than 1e-9·L\* at t₀                                                                            | error    | `segment, length`                  |
| `PULLEY_WRAP_INVALID`       | `tangentMissing` (an end inside a pulley, pulleys too close), `wrapZero`/`wrapFull` (within 1e-9 rad of 0 or 2π) | error    | `reason, segment` or `node, angle` |
| `STRING_OVERSTRETCHED`      | `restLength` shorter than the length at t₀ by more than 1e-9·L\*                                                 | error    | `length, restLength`               |
| `BODY_PENETRATES_STATIC`    | separating-axis overlap deeper than 1e-9·L\* at t₀                                                               | error    | `depth`                            |
| `STATICALLY_INDETERMINATE`  | the active force columns are dependent: the forces are not unique, the motion is                                 | warning  | `constraints, friction`            |
| `MOTION_UNDETERMINED`       | no unique motion in this mode (`singular`), or no motion at all (`inconsistent`)                                 | error    | `reason, constraints, bodies`      |

### `compileModel(spec) → { model: Model | null, diagnostics }` (`model/`)

Validates, lays out the DOFs, builds the constraints and checks the geometry at t₀. **Any error
diagnostic means `model === null`.** The `Model` is plain data (typed arrays, Maps), safe for
structured clone:

- `bodies` (sorted; `offsets` = world-oriented vertex offsets R(angle)·v), `bodyIndex`, `pulleys`,
  `appliedForces`, `nDof`, `dofs`, `mass` (per DOF), `q0`, `v0`, `options`, `maxRouteNodes`.
- `scales`: `length` L\* (bounding-box diagonal of all geometry at t₀, ≥ 1e-3 m), `gravity`,
  `velocity` V\* = max(√(g·L\*), max|v₀|), `force` F\* = max(Σm·g, max|F|), `time` = L\*/V\*.
  `GEOMETRY_REL_TOL = 1e-9` (times L\*) is the t₀ tolerance; `WRAP_ANGLE_TOL = 1e-9` rad.
- `constraints` (sorted by id; `constraintIndex`): every constraint has `id, index, kind,
sided: 'unilateral', linear, provenance { elementId, kind, symbol }, elementIds`.
  - `StringConstraint`: `kind: 'string'`, `restLength`, `nodes` (body nodes carry `dofX/dofY` and
    the world-oriented `anchor`; pulley nodes carry `center, radius, wrap`). `linear: false`.
    Provenance symbol: the string's `symbol`, or `'T'`.
  - `ContactConstraint`, id **`c:<body>:<static>:<face>`**, one per body × support face (a
    half-plane has face 0): `body, dofX, dofY, staticId, face, normal, tangent, offset, depth,
supportLo/Hi` (extent of the body's support feature along `t`, relative to `t·p`), `faceLo/Hi`
    (±∞ for a half-plane), `material`. `linear: true`. Provenance `{ elementId: body,
kind: 'contact', symbol: 'N' }`, `elementIds: [body, static]`.
  - A face's gap is **not** a penetration test: for a block on a table, the table's bottom face has
    a large negative gap. A contact matters only inside its validity domain (`contactOverlap > 0`)
    with a small |gap|; penetration is decided by `staticSeparation` (separating axes).
- `generalizedForces(model, t, q, v, out?)`: f per DOF = m·g + applied forces.
- Also exported: `staticFaces(static)`, `staticSeparation(body, static, q)`, `pairMaterial(…)`.

### Constraint interface (`constraints/`)

```ts
const row = createModelRow(model); // reusable: value, curvature, sparse J, scratch trace
const ok = evalConstraint(c, t, q, v, row); // false: a string tangent does not exist at q (NaNs)
row.value; // g
row.curvature; // J̇v
for (let k = 0; k < row.nnz; k++) J[row.idx[k]] = row.val[k];
rowDot(row, v); // ġ = J·v
```

- No allocation per call (the string trace is preallocated), so it can run inside the ODE RHS.
- After `evalConstraint` on a string, `row.trace` holds the per-segment lengths (`len`), unit
  directions (`dx, dy`), tangent points (`ax, ay, bx, by`) and per-node wrap angles (`wrap`, in
  [0, 2π)) at q: the raw material for the "segment → 0" and "wrap → 0" guards. `wrap` jumps at the
  0/2π cut, so a continuous guard must unwrap it relative to the phase's start.
- Contacts: `contactGap(c, q)`; `contactTangentialVelocity(c, v)`; `evalContactTangent(c, q, row)`
  (the stick row `J_t = tᵀ`); `contactOverlap(c, q)`, the validity domain
  `min(s + supportHi − faceLo, faceHi − (s + supportLo))` with `s = t·p`: > 0 while supported, 0
  when the support feature's trailing end is exactly at the face's end, < 0 beyond, +∞ for
  half-planes (each argument is linear in q, so either can be a guard); `contactPoint(c, q)` (the
  middle of the overlap, on the face line).
- Strings: `loadRoute`, `evalString`, `stringLength(c, q)`.

### Strings for drawing: `stringGeometry(model, stringId, q)` and `stringPath(start, vias, end)`

Both run the same code as the constraint, so the drawing matches the physics exactly. `stringPath`
works on plain world data (for the editor, before a model exists).

```ts
type StringPath =
  | {
      ok: true;
      length: number;
      segments: { from; to; direction; length }[];
      arcs: { pulley?; center; radius; wrap; from; to; startAngle; endAngle; angle }[];
    }
  | { ok: false; segment: number; reason: 'tangentMissing' };
// stringGeometry adds { id, restLength } and throws RangeError on an unknown string id.
```

`arcs[k]` lies between `segments[k]` and `segments[k + 1]`; `angle` ∈ [0, 2π) is swept in the
`wrap` sense from `from` (polar angle `startAngle` about `center`) to `to`. For R = 0,
`from = to = center`. Lower level: `createStringTrace`, `setTraceNode`, `loadTrace`, `traceString`,
`traceToPath`, `turnAngle`.

### Modes (`mode.ts`)

```ts
interface Mode {
  active: string[]; // active constraint ids, sorted
  friction: Record<string, 'stick' | 'slipPos' | 'slipNeg'>; // every active contact, and only those
}
```

A frictionless contact still needs a state; `slipPos`/`slipNeg` then add nothing. Also:
`normalizeMode`, `modeKey` (a canonical string), `slipSign`, and `assertValidMode`, which throws
`RangeError` on misuse (unknown or repeated ids, a state on a string or on an inactive contact, an
active contact without one).

### `solveAccelerations(model, mode, t, q, v) → AccelerationSolution` (`solve.ts`)

Builds and solves, for the mode's active constraints and stick rows,

```
[ M   −C ] [a]   [ f          ]      J: one row per multiplier (∂g/∂q; tᵀ for a stick row)
[ J    0 ] [λ] = [ −curvature ]      C: force columns J_iᵀ, or (J_n − μk·s·J_t)ᵀ for a sliding contact
```

so `M·a = f + C·λ`. Kinetic friction lives inside `λ_n` (no extra unknown), and K is not symmetric.

```ts
interface AccelerationSolution {
  status: 'unique' | 'indeterminate' | 'undetermined';
  a: Float64Array; // per DOF; NaN when undetermined
  lambda: Record<string, number>; // tension or normal force per active constraint (N)
  frictionLambda: Record<string, number>; // signed friction along +t per active contact:
  //                                         λ_t (stick) or −μk·s·λ_n (slip), s = ±1
  indeterminate: string[]; // constraints whose λ the equations do not determine
  indeterminateFriction: string[]; // contacts whose friction is not determined
  forces: ForceContribution[]; // empty when undetermined
  diagnostics: Diagnostic[];
}
```

- **Fast path:** pivoted QR finds `rank(J) = rank(C) = #multipliers`, and LU on the full K is
  regular. Zero masses are fine (massless knots).
- **Otherwise** (`kkt/solve-system.ts`): the DOF rows and columns are scaled by exact powers of two
  so that the mass block is O(1); a complete orthogonal decomposition then gives the minimum-norm
  solution and the null space.
  - A null vector with a nonzero a-part → `MOTION_UNDETERMINED` (`singular`).
  - A residual above 1e-9 → `MOTION_UNDETERMINED` (`inconsistent`; e.g. two taut strings demanding
    different centripetal accelerations).
  - Null vectors in λ only → `STATICALLY_INDETERMINATE`. The motion is returned exactly; the listed
    λ are the **minimum-norm split**, and their forces carry `indeterminate: true`. The UI must not
    show them as answers.
- Throws `RangeError` only for an invalid mode (an engine bug). A string with no tangent at q gives
  `PULLEY_WRAP_INVALID` and status `undetermined`.
- Lower level, for the simulator: `kktLayout(model, mode)`, `createKktSystem(model, layout)`,
  `assembleKkt(model, sys, t, q, v)` (no allocation), `solveKkt(sys)`. Inside an ODE RHS, run the
  rank analysis once per mode, then `luFactorInto` + `luSolve` on `sys.K` and `sys.rhs`.

`ForceContribution = { body, kind, sourceId, symbol, vector, point, indeterminate? }`, with `kind`
one of `'gravity' | 'normal' | 'friction' | 'tension' | 'applied'`:

- gravity (`sourceId: 'gravity'`, `symbol: 'mg'`) and applied forces, at the body's position;
- tension, one per body end of each active string, at the anchor, pulling along the string;
- normal and friction per active contact, at `contactPoint`. The friction symbol is `'F_fr'`; it is
  omitted for a sliding contact with μk = 0.

Their sum per body equals `m·a` (tested). Symbols are engine notation; the UI localizes them
(`F_fr` → `F_тр`).

```ts
const { model } = compileModel(spec);
if (!model) throw new Error('see diagnostics');
const TOP = 'c:A:table:2';
const mode = { active: [TOP, 'string'], friction: { [TOP]: 'slipPos' } } as const;
const sol = solveAccelerations(model, mode, 0, model.q0, model.v0);
sol.lambda.string; // T = 9.408 N (t02b)
-sol.frictionLambda[TOP]; // F_fr = 7.84 N, pointing away from the pulley
```
