/**
 * LU factorization with partial (row) pivoting: P·A = L·U, L unit lower triangular, U upper.
 * Golub & Van Loan, "Matrix Computations", Alg. 3.4.1; storage and pivot convention follow LAPACK
 * dgetrf/dgetrs.
 *
 * Partial pivoting does not need nonzero diagonal entries, only a nonsingular matrix. That is why
 * the engine can factor the KKT saddle-point matrix [M −Jᵀ; J 0] directly, even when M has zero
 * diagonal entries (massless elements) and the lower-right block is zero.
 */
import type { Matrix } from './matrix';

export interface LUFactorization {
  readonly n: number;
  /** Row-major n×n: U on and above the diagonal, the multipliers of L (unit diagonal) below it. */
  readonly lu: Float64Array;
  /** LAPACK convention: at elimination step k, rows k and piv[k] (≥ k) were interchanged. */
  readonly piv: Int32Array;
  /** minPivotRatio ≤ singularTol. luSolve refuses singular factorizations. */
  singular: boolean;
  /**
   * min_k |u_kk| / (|L|·|U|)_kk, in [0, 1]. Pivot k is computed as a_kk − Σ_{j<k} l_kj·u_jk, and
   * (|L|·|U|)_kk = |u_kk| + Σ_{j<k} |l_kj|·|u_jk| bounds the magnitudes that went into it. A ratio
   * near eps means the pivot is the residue of cancellation, i.e. rounding noise. Unlike
   * min|u_kk| / max|a_ij|, the ratio is invariant under row and column scaling, so a 10⁵ kg body
   * next to a 1 kg body does not look singular. It is an indicator, not a condition number;
   * rank decisions that matter (redundant constraints) should use QR (`rank`).
   */
  minPivotRatio: number;
}

export interface LUOptions {
  /** Threshold on minPivotRatio; default DEFAULT_SINGULAR_TOL. */
  singularTol?: number;
}

/**
 * Default threshold on minPivotRatio, a heuristic placed in a measured gap (lu.test.ts): random
 * numerically singular matrices up to 60×60 give ≤ 5e-13 and exactly singular KKT matrices give 0,
 * while nonsingular random KKT matrices give a median of ~0.1 whatever the mass spread, with rare
 * outliers down to ~4e-10 (nearly singular random Jacobians).
 */
export const DEFAULT_SINGULAR_TOL = 1e-11;

/** Allocates the storage for an n×n factorization (to be filled by luFactorInto). */
export function createLU(n: number): LUFactorization {
  return {
    n,
    lu: new Float64Array(n * n),
    piv: new Int32Array(n),
    singular: true,
    minPivotRatio: 0,
  };
}

/** Factors a square matrix into newly allocated storage. A is not modified. */
export function luFactor(A: Matrix, opts?: LUOptions): LUFactorization {
  return luFactorInto(A, createLU(A.rows), opts);
}

/**
 * Factors A into existing storage `f` (same n) without allocating; returns `f`.
 * Ties in the pivot search go to the lowest row index, so the result is deterministic.
 */
export function luFactorInto(A: Matrix, f: LUFactorization, opts?: LUOptions): LUFactorization {
  const n = A.rows;
  if (A.cols !== n) throw new RangeError(`luFactor: matrix is ${A.rows}×${A.cols}, not square`);
  if (f.n !== n) throw new RangeError(`luFactor: storage is for n = ${f.n}, matrix has n = ${n}`);
  const lu = f.lu;
  const piv = f.piv;
  lu.set(A.data);

  for (let k = 0; k < n; k++) {
    // Pivot: the largest |entry| in column k on or below the diagonal.
    let p = k;
    let maxAbs = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]);
      if (v > maxAbs) {
        maxAbs = v;
        p = i;
      }
    }
    piv[k] = p;
    // An all-zero column needs no elimination (like dgetrf, carry on and report singularity).
    if (maxAbs === 0) continue;

    if (p !== k) {
      const rk = k * n;
      const rp = p * n;
      for (let j = 0; j < n; j++) {
        const tmp = lu[rk + j];
        lu[rk + j] = lu[rp + j];
        lu[rp + j] = tmp;
      }
    }

    const rk = k * n;
    const pivot = lu[rk + k];
    for (let i = k + 1; i < n; i++) {
      const ri = i * n;
      const l = lu[ri + k] / pivot;
      lu[ri + k] = l;
      if (l === 0) continue;
      for (let j = k + 1; j < n; j++) lu[ri + j] -= l * lu[rk + j];
    }
  }

  let ratio = 1;
  for (let k = 0; k < n; k++) {
    const u = Math.abs(lu[k * n + k]);
    let s = u;
    for (let j = 0; j < k; j++) s += Math.abs(lu[k * n + j]) * Math.abs(lu[j * n + k]);
    ratio = Math.min(ratio, u === 0 ? 0 : u / s);
  }
  f.minPivotRatio = ratio;
  // `!(ratio > tol)` also flags NaN entries.
  f.singular = !(ratio > (opts?.singularTol ?? DEFAULT_SINGULAR_TOL));
  return f;
}

/**
 * Solves A·x = b with a factorization from luFactor; reuse it for any number of right-hand sides.
 * `out` may be `b` itself (in-place solve). Does not allocate when `out` is given.
 * Throws if the factorization is singular: there is no unique solution to report.
 */
export function luSolve(
  f: LUFactorization,
  b: ArrayLike<number>,
  out: Float64Array = new Float64Array(f.n),
): Float64Array {
  const { n, lu, piv } = f;
  if (f.singular) {
    throw new Error(
      `luSolve: matrix is singular (min pivot ratio ${f.minPivotRatio.toExponential(2)})`,
    );
  }
  if (b.length !== n || out.length < n)
    throw new RangeError(`luSolve: expected vectors of length ${n}`);
  if (out !== b) for (let i = 0; i < n; i++) out[i] = b[i];

  // x ← P·b, applying the interchanges in elimination order.
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) {
      const tmp = out[k];
      out[k] = out[p];
      out[p] = tmp;
    }
  }
  // Forward substitution with L (unit diagonal).
  for (let i = 1; i < n; i++) {
    const ri = i * n;
    let s = out[i];
    for (let j = 0; j < i; j++) s -= lu[ri + j] * out[j];
    out[i] = s;
  }
  // Back substitution with U.
  for (let i = n - 1; i >= 0; i--) {
    const ri = i * n;
    let s = out[i];
    for (let j = i + 1; j < n; j++) s -= lu[ri + j] * out[j];
    out[i] = s / lu[ri + i];
  }
  return out;
}
