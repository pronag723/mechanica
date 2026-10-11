/**
 * Seeded pseudo-random numbers for tests only (the engine itself never uses randomness).
 * mulberry32: a 32-bit generator by Tommy Ettinger; plenty for building test matrices.
 */
import { type Matrix, createMatrix } from '../../src/numeric/matrix';

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()),
  };
}

/** Entries uniform in [−1, 1). */
export function randomMatrix(rng: Rng, rows: number, cols: number): Matrix {
  const A = createMatrix(rows, cols);
  for (let k = 0; k < A.data.length; k++) A.data[k] = rng.uniform(-1, 1);
  return A;
}

export function randomVector(rng: Rng, n: number): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.uniform(-1, 1);
  return x;
}
