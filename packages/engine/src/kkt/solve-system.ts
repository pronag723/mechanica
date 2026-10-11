/**
 * Solving the KKT system with a rank check (DESIGN §3.2, §3.6).
 *
 * Fast path: J has full row rank and C full column rank (pivoted QR), and LU on the full K
 * succeeds. Then a and λ are unique.
 *
 * Otherwise the system is analysed with a complete orthogonal decomposition. The solution set is
 * x_p + null(K) (if consistent). With x = (a, λ):
 * - a null vector with a nonzero a-part means the motion itself is not determined (a massless
 *   body nothing pins down, or frictional jamming): MOTION_UNDETERMINED;
 * - an inconsistent system (residual of the least-squares solution) has no motion in this mode:
 *   MOTION_UNDETERMINED as well;
 * - null vectors with zero a-part are force distributions C·δλ = 0: the motion is unique but the
 *   multipliers they touch are statically indeterminate. We return the minimum-norm λ (one
 *   admissible distribution, flagged) and list the indeterminate multipliers.
 * Before the decomposition, each DOF row and column is scaled by 2^−k with 4^k ≈ m (exact in
 * floating point), so the mass block is O(1) and null-vector components compare across units.
 */
import { luFactor, luSolve } from '../numeric/lu';
import { type Matrix, createMatrix } from '../numeric/matrix';
import { leastSquaresMinNorm, nullSpace, rank } from '../numeric/qr';
import type { KktSystem } from './assemble';

/** A null-vector component above this (null vectors are orthonormal) is structurally nonzero. */
const NULL_COMPONENT_TOL = 1e-8;
/** Relative residual above which a singular system counts as inconsistent. */
const RESIDUAL_TOL = 1e-9;

export type KktStatus = 'unique' | 'indeterminate' | 'undetermined';

export interface KktSolution {
  readonly status: KktStatus;
  /** [a; λ]; NaN when the status is `undetermined`. */
  readonly x: Float64Array;
  /** Multiplier positions (0-based, in layout order) that the equations do not determine. */
  readonly indeterminate: readonly number[];
  /** For `undetermined`: why, and the DOFs and multipliers involved. */
  readonly reason?: 'singular' | 'inconsistent';
  readonly undeterminedDofs: readonly number[];
  readonly undeterminedMultipliers: readonly number[];
}

export function solveKkt(sys: KktSystem): KktSolution {
  const { layout, K, rhs, J, C } = sys;
  const m = layout.nMult;
  const fullRank = m === 0 || (rank(J) === m && rank(C) === m);
  if (fullRank) {
    const lu = luFactor(K);
    if (!lu.singular) {
      return {
        status: 'unique',
        x: luSolve(lu, rhs),
        indeterminate: [],
        undeterminedDofs: [],
        undeterminedMultipliers: [],
      };
    }
  }
  return analyse(sys);
}

function analyse(sys: KktSystem): KktSolution {
  const { layout, K, rhs } = sys;
  const n = layout.nDof;
  const N = layout.size;
  const scale = new Float64Array(N).fill(1);
  for (let i = 0; i < n; i++) {
    const mass = K.data[i * N + i];
    if (mass > 0) scale[i] = 2 ** -Math.round(Math.log2(mass) / 2);
  }
  const Ks: Matrix = createMatrix(N, N);
  const bs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    bs[i] = scale[i] * rhs[i];
    for (let j = 0; j < N; j++) Ks.data[i * N + j] = scale[i] * K.data[i * N + j] * scale[j];
  }

  const Z = nullSpace(Ks);
  const nNull = Z.cols;
  const xs = leastSquaresMinNorm(Ks, bs);

  const undeterminedDofs = new Set<number>();
  const undeterminedMultipliers = new Set<number>();
  const indeterminate = new Set<number>();
  for (let k = 0; k < nNull; k++) {
    let aPart = 0;
    for (let i = 0; i < n; i++) aPart = Math.max(aPart, Math.abs(Z.data[i * nNull + k]));
    const motion = aPart > NULL_COMPONENT_TOL;
    for (let i = 0; i < N; i++) {
      if (Math.abs(Z.data[i * nNull + k]) <= NULL_COMPONENT_TOL) continue;
      if (motion) (i < n ? undeterminedDofs : undeterminedMultipliers).add(i < n ? i : i - n);
      else if (i >= n) indeterminate.add(i - n);
    }
  }

  // Consistency: ‖Ks·xs − bs‖∞ against the sizes of the terms.
  let res = 0;
  let size = 0;
  for (let i = 0; i < N; i++) {
    let s = -bs[i];
    let mag = Math.abs(bs[i]);
    for (let j = 0; j < N; j++) {
      const term = Ks.data[i * N + j] * xs[j];
      s += term;
      mag += Math.abs(term);
    }
    res = Math.max(res, Math.abs(s));
    size = Math.max(size, mag);
  }
  const consistent = res <= RESIDUAL_TOL * size;

  const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
  if (undeterminedDofs.size > 0 || !consistent) {
    return {
      status: 'undetermined',
      x: new Float64Array(N).fill(NaN),
      indeterminate: [],
      reason: consistent ? 'singular' : 'inconsistent',
      undeterminedDofs: sorted(undeterminedDofs),
      undeterminedMultipliers: sorted(undeterminedMultipliers),
    };
  }
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = scale[i] * xs[i];
  return {
    status: indeterminate.size > 0 ? 'indeterminate' : 'unique',
    x,
    indeterminate: sorted(indeterminate),
    undeterminedDofs: [],
    undeterminedMultipliers: [],
  };
}
