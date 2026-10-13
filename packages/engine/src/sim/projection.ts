/**
 * Drift projection onto the active constraints (DESIGN §3.3; never Baumgarte).
 *
 * Positions: mass-weighted Gauss–Newton on g_A(q) = 0. Each iteration solves
 *   min ½·Δqᵀ·M·Δq  s.t.  J·Δq = −g     ⇔   [M  Jᵀ; J  0]·[Δq; μ] = [0; −g],
 * whose LU handles massless coordinates (pinned by their constraints). The rows are the active
 * constraints plus the stick rows with g = 0, so a sticking contact is not moved along its face.
 * Redundant rows (statically indeterminate modes) fall back to the minimum-norm least-squares
 * solution of the same system.
 *
 * Velocities: the M-orthogonal projection onto null(J_A) (J_A including stick rows): the velocity
 * closest to v in kinetic-energy norm with J_A·v⁺ = 0, computed in correction form
 *   [M  Jᵀ; J  0]·[δ; μ] = [0; −J·v],   v⁺ = v + δ   (δ = −M⁻¹Jᵀμ).
 * When rank J_A = nDof (every coordinate pinned), v⁺ = 0 is set exactly; that keeps "at rest"
 * exact after a stick event.
 */
import { createModelRow, evalConstraint, evalContactTangent } from '../constraints';
import type { ConstraintRow } from '../constraints/row';
import type { ContactConstraint, Model } from '../model/types';
import type { Mode } from '../mode';
import { luFactor, luSolve } from '../numeric/lu';
import { type Matrix, createMatrix } from '../numeric/matrix';
import { leastSquaresMinNorm, rank } from '../numeric/qr';

interface Rows {
  readonly J: Matrix;
  readonly g: Float64Array;
  ok: boolean;
}

/** J_A (active constraints, then stick rows) and g_A at q (stick rows: g = 0). */
function activeRows(model: Model, mode: Mode, q: ArrayLike<number>, row: ConstraintRow): Rows {
  const n = model.nDof;
  const ids = mode.active;
  const stick = ids.filter((id) => mode.friction[id] === 'stick');
  const m = ids.length + stick.length;
  const J = createMatrix(m, n);
  const g = new Float64Array(m);
  const zero = new Float64Array(n);
  let ok = true;
  ids.forEach((id, r) => {
    const c = model.constraints[model.constraintIndex.get(id) ?? -1];
    if (!evalConstraint(c, 0, q, zero, row)) ok = false;
    g[r] = row.value;
    for (let k = 0; k < row.nnz; k++) J.data[r * n + row.idx[k]] += row.val[k];
  });
  stick.forEach((id, k) => {
    const c = model.constraints[model.constraintIndex.get(id) ?? -1] as ContactConstraint;
    evalContactTangent(c, q, row);
    const r = ids.length + k;
    for (let e = 0; e < row.nnz; e++) J.data[r * n + row.idx[e]] += row.val[e];
  });
  return { J, g, ok };
}

export interface ProjectionResult {
  /** ‖Δ‖∞ applied. */
  readonly delta: number;
  /** max |g_A| (positions) or max |J_A·v| (velocities) after projecting. */
  readonly residual: number;
  readonly ok: boolean;
}

/** Projects q (in place) onto g_A(q) = 0: at most `maxIter` Gauss–Newton steps, until |g| ≤ tol. */
export function projectPositions(
  model: Model,
  mode: Mode,
  q: Float64Array,
  tol: number,
  maxIter = 3,
): ProjectionResult {
  const n = model.nDof;
  const row = createModelRow(model);
  const q0 = Float64Array.from(q);
  let rows = activeRows(model, mode, q, row);
  let res = maxAbs(rows.g);
  for (let it = 0; it < maxIter && rows.ok && res > tol; it++) {
    const m = rows.g.length;
    const N = n + m;
    const K = createMatrix(N, N);
    const b = new Float64Array(N);
    for (let i = 0; i < n; i++) K.data[i * N + i] = model.mass[i];
    for (let r = 0; r < m; r++) {
      for (let i = 0; i < n; i++) {
        const x = rows.J.data[r * n + i];
        K.data[i * N + n + r] = x;
        K.data[(n + r) * N + i] = x;
      }
      b[n + r] = -rows.g[r];
    }
    const lu = luFactor(K);
    const x = lu.singular ? leastSquaresMinNorm(K, b) : luSolve(lu, b);
    for (let i = 0; i < n; i++) q[i] += x[i];
    rows = activeRows(model, mode, q, row);
    res = maxAbs(rows.g);
  }
  let delta = 0;
  for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(q[i] - q0[i]));
  return { delta, residual: res, ok: rows.ok };
}

/**
 * Projects v (in place) onto J_A(q)·v = 0 in the M-metric. Skipped when max |J_A·v| ≤ skipBelow
 * (pass −1 to always project).
 */
export function projectVelocities(
  model: Model,
  mode: Mode,
  q: ArrayLike<number>,
  v: Float64Array,
  skipBelow: number,
): ProjectionResult {
  const n = model.nDof;
  const row = createModelRow(model);
  const rows = activeRows(model, mode, q, row);
  const m = rows.g.length;
  const Jv = (vv: ArrayLike<number>): number => {
    let r = 0;
    for (let k = 0; k < m; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += rows.J.data[k * n + i] * vv[i];
      r = Math.max(r, Math.abs(s));
    }
    return r;
  };
  const before = Jv(v);
  if (m === 0 || !rows.ok || before <= skipBelow)
    return { delta: 0, residual: before, ok: rows.ok };

  const vNew = new Float64Array(n);
  if (rank(rows.J) < n) {
    // Correction form: [M  Jᵀ; J  0]·[δ; μ] = [0; −J·v], v⁺ = v + δ. Coordinates outside J's
    // support get δ = 0 exactly (when their mass is positive).
    const N = n + m;
    const K = createMatrix(N, N);
    const b = new Float64Array(N);
    for (let i = 0; i < n; i++) K.data[i * N + i] = model.mass[i];
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const x = rows.J.data[r * n + i];
        K.data[i * N + n + r] = x;
        K.data[(n + r) * N + i] = x;
        s += x * v[i];
      }
      b[n + r] = -s;
    }
    const lu = luFactor(K);
    const x = lu.singular ? leastSquaresMinNorm(K, b) : luSolve(lu, b);
    for (let i = 0; i < n; i++) vNew[i] = v[i] + x[i];
  } // else J_A pins every coordinate: v⁺ = 0 exactly.
  let delta = 0;
  for (let i = 0; i < n; i++) {
    delta = Math.max(delta, Math.abs(vNew[i] - v[i]));
    v[i] = vNew[i];
  }
  return { delta, residual: Jv(v), ok: true };
}

function maxAbs(x: ArrayLike<number>): number {
  let r = 0;
  for (let i = 0; i < x.length; i++) r = Math.max(r, Math.abs(x[i]));
  return r;
}
