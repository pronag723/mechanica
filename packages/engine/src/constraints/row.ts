/**
 * A reusable buffer for one evaluated constraint: value g, sparse Jacobian row J = ∂g/∂q and the
 * curvature term J̇v (+ ∂²g/∂t² terms, none in Phase 0), so that g̈ = J·a + curvature. It carries
 * a scratch string trace, so evaluating a string inside the ODE right-hand side does not allocate.
 */
import { type StringTrace, createStringTrace } from '../geometry/string-path';

export interface ConstraintRow {
  value: number;
  curvature: number;
  /** Number of nonzeros; entries idx[k] (DOF index, distinct) and val[k] for k < nnz. */
  nnz: number;
  readonly idx: Int32Array;
  readonly val: Float64Array;
  readonly trace: StringTrace;
}

/** Room for `maxNnz` nonzeros and strings of up to `maxNodes` route nodes. */
export function createConstraintRow(maxNnz: number, maxNodes: number): ConstraintRow {
  return {
    value: NaN,
    curvature: NaN,
    nnz: 0,
    idx: new Int32Array(maxNnz),
    val: new Float64Array(maxNnz),
    trace: createStringTrace(Math.max(2, maxNodes)),
  };
}

/** Adds `x` to entry `dof` of the row, merging with an existing entry (a string tied twice to one body). */
export function addEntry(row: ConstraintRow, dof: number, x: number): void {
  for (let k = 0; k < row.nnz; k++) {
    if (row.idx[k] === dof) {
      row.val[k] += x;
      return;
    }
  }
  row.idx[row.nnz] = dof;
  row.val[row.nnz] = x;
  row.nnz++;
}

/** J·x for a dense vector x. */
export function rowDot(row: ConstraintRow, x: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < row.nnz; k++) s += row.val[k] * x[row.idx[k]];
  return s;
}
