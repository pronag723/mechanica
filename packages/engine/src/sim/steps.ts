/**
 * Phase dense output: the simulator copies each accepted DOPRI5 step's coefficients r₁…r₅ into a
 * growable per-phase buffer (so the stepper's shared chunks are not kept alive), and the
 * trajectory functions evaluate them. Same polynomial as numeric/dense.ts (Hairer's CONTD5):
 *   y(θ) = r₁ + θ·(r₂ + θ'·(r₃ + θ·(r₄ + θ'·r₅))),  θ = (t − t₀)/h,  θ' = 1 − θ.
 */
import type { AcceptedStep } from '../numeric/dense';
import type { PhaseSteps } from './types';

export interface StepBuilder {
  readonly dim: number;
  readonly t0: number[];
  readonly h: number[];
  coeffs: Float64Array;
  count: number;
}

export function createStepBuilder(dim: number): StepBuilder {
  return { dim, t0: [], h: [], coeffs: new Float64Array(5 * dim * 8), count: 0 };
}

function reserve(b: StepBuilder): number {
  const per = 5 * b.dim;
  if ((b.count + 1) * per > b.coeffs.length) {
    const grown = new Float64Array(b.coeffs.length * 2);
    grown.set(b.coeffs);
    b.coeffs = grown;
  }
  return b.count * per;
}

/** Appends an accepted step (its r₁…r₅). */
export function pushStep(b: StepBuilder, step: AcceptedStep): void {
  const o = reserve(b);
  b.coeffs.set(step.data.subarray(step.offset, step.offset + 5 * b.dim), o);
  b.t0.push(step.t0);
  b.h.push(step.h);
  b.count++;
}

/** Appends a constant step y(t) ≡ y on [t0, t0 + h] (an at-rest span). */
export function pushConstant(b: StepBuilder, t0: number, h: number, y: ArrayLike<number>): void {
  const o = reserve(b);
  b.coeffs.fill(0, o, o + 5 * b.dim);
  for (let i = 0; i < b.dim; i++) b.coeffs[o + i] = y[i];
  b.t0.push(t0);
  b.h.push(h);
  b.count++;
}

export function finishSteps(b: StepBuilder): PhaseSteps {
  return {
    t0: Float64Array.from(b.t0),
    h: Float64Array.from(b.h),
    coeffs: b.coeffs.slice(0, b.count * 5 * b.dim),
  };
}

/** y(t) of stored step k into `out`. */
export function evalStoredStep(
  steps: PhaseSteps,
  dim: number,
  k: number,
  t: number,
  out: Float64Array,
): Float64Array {
  const c = steps.coeffs;
  const o = k * 5 * dim;
  const s = (t - steps.t0[k]) / steps.h[k];
  const s1 = 1 - s;
  for (let i = 0; i < dim; i++) {
    const j = o + i;
    out[i] =
      c[j] + s * (c[j + dim] + s1 * (c[j + 2 * dim] + s * (c[j + 3 * dim] + s1 * c[j + 4 * dim])));
  }
  return out;
}

/**
 * Index of the stored step containing t: the last k with t0[k] ≤ t, or with side 'before' the last
 * k with t0[k] < t (so a step boundary belongs to the step ending there). Clamped to [0, n − 1].
 */
export function findStep(steps: PhaseSteps, t: number, side: 'before' | 'after'): number {
  const t0 = steps.t0;
  let lo = 0;
  let hi = t0.length - 1;
  if (hi <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (side === 'after' ? t0[mid] <= t : t0[mid] < t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
