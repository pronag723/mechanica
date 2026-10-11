/**
 * Householder QR with column pivoting, A·P = Q·R (Golub & Van Loan, "Matrix Computations",
 * Alg. 5.4.1; reflector convention of LAPACK dlarfg/dgeqp3), and the complete orthogonal
 * decomposition built on it for rank, minimum-norm least squares and null spaces.
 *
 * With pivoting, |r_00| ≥ |r_11| ≥ … : step k brings forward the trailing column of largest norm.
 * The trailing norms are recomputed at every step instead of downdated. That costs about as much
 * as the factorization itself, which is nothing at engine sizes (≤ 60), and sidesteps the
 * cancellation problem of norm downdating.
 */
import { EPS, type Matrix, createMatrix } from './matrix';

export interface QRFactorization {
  readonly m: number;
  readonly n: number;
  /** Row-major m×n: R on and above the diagonal; below it, the Householder vectors v_k (v_k[k] = 1 implied). */
  readonly qr: Float64Array;
  /** Reflector scalars: H_k = I − tau_k·v_k·v_kᵀ, Q = H_0·H_1·…·H_{p−1}, p = min(m, n). */
  readonly tau: Float64Array;
  /** Column j of A·P is column perm[j] of A. The identity when pivoting is off. */
  readonly perm: Int32Array;
}

export interface QROptions {
  /** Column pivoting (default true). Rank decisions need it. */
  pivoting?: boolean;
}

export interface RankOptions {
  /**
   * Absolute threshold on |r_kk|. Default max(m, n)·eps·|r_00|: diagonal entries of R below it
   * are at the rounding level of the factorization and count as zero.
   */
  tol?: number;
}

export function qrFactor(A: Matrix, opts?: QROptions): QRFactorization {
  const { rows: m, cols: n } = A;
  const f: QRFactorization = {
    m,
    n,
    qr: Float64Array.from(A.data),
    tau: new Float64Array(Math.min(m, n)),
    perm: Int32Array.from({ length: n }, (_, j) => j),
  };
  householder(f, opts?.pivoting ?? true);
  return f;
}

function householder(f: QRFactorization, pivoting: boolean): void {
  const { m, n, qr, tau, perm } = f;
  const p = Math.min(m, n);
  for (let k = 0; k < p; k++) {
    if (pivoting) {
      // Bring the trailing column (rows k..m−1) of largest norm to position k; ties → lowest index.
      let best = k;
      let bestNorm = -1;
      for (let j = k; j < n; j++) {
        let s = 0;
        for (let i = k; i < m; i++) s += qr[i * n + j] * qr[i * n + j];
        if (s > bestNorm) {
          bestNorm = s;
          best = j;
        }
      }
      if (best !== k) {
        for (let i = 0; i < m; i++) {
          const tmp = qr[i * n + k];
          qr[i * n + k] = qr[i * n + best];
          qr[i * n + best] = tmp;
        }
        const tp = perm[k];
        perm[k] = perm[best];
        perm[best] = tp;
      }
    }

    // Reflector H_k mapping x = qr[k:m, k] to (β, 0, …, 0) with β = −sign(x_0)·‖x‖ (no cancellation).
    const alpha = qr[k * n + k];
    let xnorm2 = 0;
    for (let i = k + 1; i < m; i++) xnorm2 += qr[i * n + k] * qr[i * n + k];
    if (xnorm2 === 0) {
      tau[k] = 0; // x is already a multiple of e_0: H_k = I.
      continue;
    }
    const norm = Math.sqrt(alpha * alpha + xnorm2);
    const beta = alpha >= 0 ? -norm : norm;
    const t = (beta - alpha) / beta;
    tau[k] = t;
    const scale = 1 / (alpha - beta);
    for (let i = k + 1; i < m; i++) qr[i * n + k] *= scale;
    qr[k * n + k] = beta;

    // Trailing columns: c ← c − tau·v·(vᵀc).
    for (let j = k + 1; j < n; j++) {
      let w = qr[k * n + j];
      for (let i = k + 1; i < m; i++) w += qr[i * n + k] * qr[i * n + j];
      w *= t;
      qr[k * n + j] -= w;
      for (let i = k + 1; i < m; i++) qr[i * n + j] -= w * qr[i * n + k];
    }
  }
}

/** x ← H_k·x for the stored reflector k (H_k is symmetric, so this is also H_kᵀ). */
function applyReflector(f: QRFactorization, k: number, x: Float64Array): void {
  const t = f.tau[k];
  if (t === 0) return;
  const { m, n, qr } = f;
  let w = x[k];
  for (let i = k + 1; i < m; i++) w += qr[i * n + k] * x[i];
  w *= t;
  x[k] -= w;
  for (let i = k + 1; i < m; i++) x[i] -= w * qr[i * n + k];
}

/** x ← Qᵀ·x in place (length m). */
export function applyQt(f: QRFactorization, x: Float64Array): Float64Array {
  for (let k = 0; k < f.tau.length; k++) applyReflector(f, k, x);
  return x;
}

/** x ← Q·x in place (length m). */
export function applyQ(f: QRFactorization, x: Float64Array): Float64Array {
  for (let k = f.tau.length - 1; k >= 0; k--) applyReflector(f, k, x);
  return x;
}

/** Thin Q (m × min(m, n)), with orthonormal columns. */
export function formQ(f: QRFactorization): Matrix {
  const p = Math.min(f.m, f.n);
  const Q = createMatrix(f.m, p);
  const e = new Float64Array(f.m);
  for (let j = 0; j < p; j++) {
    e.fill(0);
    e[j] = 1;
    applyQ(f, e);
    for (let i = 0; i < f.m; i++) Q.data[i * p + j] = e[i];
  }
  return Q;
}

/** R (min(m, n) × n), upper triangular (trapezoidal when m < n). */
export function extractR(f: QRFactorization): Matrix {
  const p = Math.min(f.m, f.n);
  const R = createMatrix(p, f.n);
  for (let i = 0; i < p; i++) {
    for (let j = i; j < f.n; j++) R.data[i * f.n + j] = f.qr[i * f.n + j];
  }
  return R;
}

/** Numerical rank from a pivoted factorization: the number of |r_kk| above the threshold. */
export function qrRank(f: QRFactorization, opts?: RankOptions): number {
  const p = Math.min(f.m, f.n);
  if (p === 0) return 0;
  const tol = opts?.tol ?? Math.max(f.m, f.n) * EPS * Math.abs(f.qr[0]);
  let r = 0;
  while (r < p && Math.abs(f.qr[r * f.n + r]) > tol) r++;
  return r;
}

/** Numerical rank of A (see RankOptions for the default tolerance). */
export function rank(A: Matrix, opts?: RankOptions): number {
  return qrRank(qrFactor(A), opts);
}

/**
 * Complete orthogonal decomposition A·P = Q·[R11 R12; 0 0], [R11 R12]ᵀ = Z·[S; 0], so that
 * A = Q·[Sᵀ 0; 0 0]·Zᵀ·Pᵀ with S (r×r) upper triangular and nonsingular (LAPACK dgelsy's idea,
 * with a second QR in place of dtzrzf).
 */
export interface CompleteOrthogonalDecomposition {
  readonly qr: QRFactorization;
  readonly rank: number;
  /** Unpivoted QR of [R11 R12]ᵀ (n × rank). */
  readonly z: QRFactorization;
}

export function completeOrthogonal(A: Matrix, opts?: RankOptions): CompleteOrthogonalDecomposition {
  const f = qrFactor(A);
  const r = qrRank(f, opts);
  const n = f.n;
  // W = [R11 R12]ᵀ: W[j][i] = R[i][j] for the first r rows of R.
  const W = createMatrix(n, r);
  for (let i = 0; i < r; i++) {
    for (let j = i; j < n; j++) W.data[j * r + i] = f.qr[i * n + j];
  }
  return { qr: f, rank: r, z: qrFactor(W, { pivoting: false }) };
}

/**
 * Minimum-norm least-squares solution: among all minimizers of ‖A·x − b‖₂, the one of least ‖x‖₂.
 * With c = Qᵀb and y = Zᵀ·Pᵀ·x: ‖A·x − b‖² = ‖Sᵀ·y₁ − c₁‖² + ‖c₂‖², minimized by Sᵀ·y₁ = c₁, and
 * ‖x‖ = ‖y‖ is least for y₂ = 0.
 */
export function leastSquaresMinNorm(
  A: Matrix,
  b: ArrayLike<number>,
  opts?: RankOptions,
): Float64Array {
  if (b.length !== A.rows)
    throw new RangeError(`leastSquaresMinNorm: b has ${b.length} ≠ ${A.rows} entries`);
  const cod = completeOrthogonal(A, opts);
  const { qr: f, rank: r, z } = cod;
  const n = f.n;

  const c = applyQt(f, Float64Array.from(b));
  // Forward substitution with Sᵀ (lower triangular): Sᵀ[i][j] = S[j][i] = z.qr[j·r + i].
  const y = new Float64Array(n);
  for (let i = 0; i < r; i++) {
    let s = c[i];
    for (let j = 0; j < i; j++) s -= z.qr[j * r + i] * y[j];
    y[i] = s / z.qr[i * r + i];
  }
  applyQ(z, y); // y ← Z·[y₁; 0]
  const x = new Float64Array(n);
  for (let j = 0; j < n; j++) x[f.perm[j]] = y[j];
  return x;
}

/**
 * Orthonormal basis of the null space of A as the columns of an n × (n − rank) matrix:
 * A·P·Z·e_j = Q·[Sᵀ 0; 0 0]·e_j = 0 for j ≥ rank, and P·Z is orthogonal.
 */
export function nullSpace(A: Matrix, opts?: RankOptions): Matrix {
  const { qr: f, rank: r, z } = completeOrthogonal(A, opts);
  const n = f.n;
  const N = createMatrix(n, n - r);
  const e = new Float64Array(n);
  for (let k = 0; k < n - r; k++) {
    e.fill(0);
    e[r + k] = 1;
    applyQ(z, e);
    for (let j = 0; j < n; j++) N.data[f.perm[j] * (n - r) + k] = e[j];
  }
  return N;
}
