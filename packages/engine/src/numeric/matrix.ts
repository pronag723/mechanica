/**
 * Small dense matrices: row-major Float64Array storage, entry (i, j) at data[i·cols + j].
 * Sizes in the engine stay below ~60×60, so everything here is plain O(n²)/O(n³) loops.
 */

export interface Matrix {
  readonly rows: number;
  readonly cols: number;
  /** Row-major entries; mutable so solvers can work in place. */
  readonly data: Float64Array;
}

/** Machine epsilon for doubles, 2⁻⁵². */
export const EPS = Number.EPSILON;

export function createMatrix(rows: number, cols: number): Matrix {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0) {
    throw new RangeError(`createMatrix: invalid size ${rows}×${cols}`);
  }
  return { rows, cols, data: new Float64Array(rows * cols) };
}

/** Builds a matrix from nested rows; every row must have the same length. */
export function matrixFromRows(rows: readonly (readonly number[])[]): Matrix {
  const m = rows.length;
  const n = m === 0 ? 0 : rows[0].length;
  const A = createMatrix(m, n);
  for (let i = 0; i < m; i++) {
    const row = rows[i];
    if (row.length !== n)
      throw new RangeError(`matrixFromRows: row ${i} has ${row.length} ≠ ${n} entries`);
    for (let j = 0; j < n; j++) A.data[i * n + j] = row[j];
  }
  return A;
}

/** Nested-array copy, convenient in tests and diagnostics. */
export function matrixToRows(A: Matrix): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < A.rows; i++)
    out.push(Array.from(A.data.subarray(i * A.cols, (i + 1) * A.cols)));
  return out;
}

export function identity(n: number): Matrix {
  const I = createMatrix(n, n);
  for (let i = 0; i < n; i++) I.data[i * n + i] = 1;
  return I;
}

export function getEntry(A: Matrix, i: number, j: number): number {
  return A.data[i * A.cols + j];
}

export function setEntry(A: Matrix, i: number, j: number, value: number): void {
  A.data[i * A.cols + j] = value;
}

export function copyMatrix(A: Matrix): Matrix {
  return { rows: A.rows, cols: A.cols, data: Float64Array.from(A.data) };
}

export function transpose(A: Matrix): Matrix {
  const T = createMatrix(A.cols, A.rows);
  for (let i = 0; i < A.rows; i++) {
    for (let j = 0; j < A.cols; j++) T.data[j * A.rows + i] = A.data[i * A.cols + j];
  }
  return T;
}

/** out = A·x (length A.rows). `out` must not alias `x`. */
export function matVec(
  A: Matrix,
  x: ArrayLike<number>,
  out = new Float64Array(A.rows),
): Float64Array {
  const { rows, cols, data } = A;
  for (let i = 0; i < rows; i++) {
    let s = 0;
    const r = i * cols;
    for (let j = 0; j < cols; j++) s += data[r + j] * x[j];
    out[i] = s;
  }
  return out;
}

/** out = Aᵀ·x (length A.cols). `out` must not alias `x`. */
export function matTVec(
  A: Matrix,
  x: ArrayLike<number>,
  out = new Float64Array(A.cols),
): Float64Array {
  const { rows, cols, data } = A;
  out.fill(0, 0, cols);
  for (let i = 0; i < rows; i++) {
    const xi = x[i];
    const r = i * cols;
    for (let j = 0; j < cols; j++) out[j] += data[r + j] * xi;
  }
  return out;
}

export function matMul(A: Matrix, B: Matrix): Matrix {
  if (A.cols !== B.rows) throw new RangeError(`matMul: ${A.rows}×${A.cols} · ${B.rows}×${B.cols}`);
  const C = createMatrix(A.rows, B.cols);
  const n = B.cols;
  for (let i = 0; i < A.rows; i++) {
    for (let k = 0; k < A.cols; k++) {
      const a = A.data[i * A.cols + k];
      if (a === 0) continue;
      const rb = k * n;
      const rc = i * n;
      for (let j = 0; j < n; j++) C.data[rc + j] += a * B.data[rb + j];
    }
  }
  return C;
}

/** max_ij |a_ij|. */
export function normMax(A: Matrix): number {
  let m = 0;
  for (let k = 0; k < A.data.length; k++) m = Math.max(m, Math.abs(A.data[k]));
  return m;
}

/** ‖A‖∞ = max row sum of |a_ij|. */
export function normInf(A: Matrix): number {
  let m = 0;
  for (let i = 0; i < A.rows; i++) {
    let s = 0;
    for (let j = 0; j < A.cols; j++) s += Math.abs(A.data[i * A.cols + j]);
    m = Math.max(m, s);
  }
  return m;
}

/** ‖A‖₁ = max column sum of |a_ij|. */
export function norm1(A: Matrix): number {
  let m = 0;
  for (let j = 0; j < A.cols; j++) {
    let s = 0;
    for (let i = 0; i < A.rows; i++) s += Math.abs(A.data[i * A.cols + j]);
    m = Math.max(m, s);
  }
  return m;
}

/** Frobenius norm. */
export function normFro(A: Matrix): number {
  return vecNorm2(A.data);
}

export function vecNorm2(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s);
}

export function vecNormInf(x: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}
