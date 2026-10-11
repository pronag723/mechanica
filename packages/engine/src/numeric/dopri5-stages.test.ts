import { describe, expect, it } from 'vitest';
import { createStep, evalDense, fillDense } from './dense';
import { DOPRI5_TABLEAU } from './dopri5-stages';

/**
 * Runge–Kutta order conditions (Butcher trees) up to order 5: for each rooted tree t, a stage
 * vector Φ(t) and the density γ(t); weights w have order p if w·Φ(t) = 1/γ(t) for all |t| ≤ p.
 * For continuous weights w(θ) of order p: w(θ)·Φ(t) = θ^|t|/γ(t).
 */
const { a, b, c, d, e } = DOPRI5_TABLEAU;
const S = 7;
const one = Array<number>(S).fill(1);
const mul = (u: readonly number[], v: readonly number[]) => u.map((x, i) => x * v[i]);
const Av = (v: readonly number[]) => a.map((row) => row.reduce((s, aij, j) => s + aij * v[j], 0));
const dot = (u: readonly number[], v: readonly number[]) => u.reduce((s, x, i) => s + x * v[i], 0);
const c2 = mul(c, c);
const c3 = mul(c2, c);
const Ac = Av(c);
const Ac2 = Av(c2);
const AAc = Av(Ac);

const TREES: { order: number; phi: readonly number[]; gamma: number; name: string }[] = [
  { order: 1, phi: one, gamma: 1, name: 'Σb = 1' },
  { order: 2, phi: c, gamma: 2, name: 'Σbc' },
  { order: 3, phi: c2, gamma: 3, name: 'Σbc²' },
  { order: 3, phi: Ac, gamma: 6, name: 'ΣbAc' },
  { order: 4, phi: c3, gamma: 4, name: 'Σbc³' },
  { order: 4, phi: mul(c, Ac), gamma: 8, name: 'Σbc·Ac' },
  { order: 4, phi: Ac2, gamma: 12, name: 'ΣbAc²' },
  { order: 4, phi: AAc, gamma: 24, name: 'ΣbAAc' },
  { order: 5, phi: mul(c3, c), gamma: 5, name: 'Σbc⁴' },
  { order: 5, phi: mul(c2, Ac), gamma: 10, name: 'Σbc²·Ac' },
  { order: 5, phi: mul(c, Ac2), gamma: 15, name: 'Σbc·Ac²' },
  { order: 5, phi: mul(c, AAc), gamma: 30, name: 'Σbc·AAc' },
  { order: 5, phi: mul(Ac, Ac), gamma: 20, name: 'Σb(Ac)²' },
  { order: 5, phi: Av(c3), gamma: 20, name: 'ΣbAc³' },
  { order: 5, phi: Av(mul(c, Ac)), gamma: 40, name: 'ΣbA(c·Ac)' },
  { order: 5, phi: Av(Ac2), gamma: 60, name: 'ΣbAAc²' },
  { order: 5, phi: Av(AAc), gamma: 120, name: 'ΣbAAAc' },
];

/** Continuous weights b(θ), read off the production dense-output code with k_j = e_j, h = 1. */
function denseWeights(theta: number): number[] {
  const unit = (j: number) => Float64Array.from({ length: S }, (_, i) => (i === j ? 1 : 0));
  const step = createStep(S, 0, 1, 1);
  fillDense(
    step,
    new Float64Array(S),
    Float64Array.from(b),
    unit(0),
    unit(2),
    unit(3),
    unit(4),
    unit(5),
    unit(6),
  );
  return Array.from(evalDense(step, theta, new Float64Array(S)));
}

describe('Dormand–Prince 5(4) tableau', () => {
  it('row sums: c_i = Σ_j a_ij, and stage 7 is FSAL (a_7j = b_j, c_7 = 1)', () => {
    a.forEach((row, i) => expect(row.reduce((s, x) => s + x, 0)).toBeCloseTo(c[i], 15));
    expect(a[6]).toEqual(b);
  });

  it.each(TREES)('5th-order weights: $name = 1/$gamma', ({ phi, gamma }) => {
    expect(Math.abs(dot(b, phi) - 1 / gamma)).toBeLessThanOrEqual(1e-15);
  });

  it('embedded weights b̂ = b − e have order exactly 4', () => {
    const bHat = b.map((x, i) => x - e[i]);
    for (const { order, phi, gamma } of TREES) {
      const defect = Math.abs(dot(bHat, phi) - 1 / gamma);
      if (order <= 4) expect(defect).toBeLessThanOrEqual(1e-15);
    }
    const order5 = TREES.filter((t) => t.order === 5);
    expect(
      Math.max(...order5.map(({ phi, gamma }) => Math.abs(dot(bHat, phi) - 1 / gamma))),
    ).toBeGreaterThan(1e-4);
  });

  it.each([0.1, 0.25, 0.5, 0.75, 0.9, 1])('dense weights b(%f) have order 4', (theta) => {
    const w = denseWeights(theta);
    for (const { order, phi, gamma } of TREES) {
      if (order <= 4)
        expect(Math.abs(dot(w, phi) - theta ** order / gamma)).toBeLessThanOrEqual(1e-14);
    }
  });

  it('dense weights interpolate: b(0) = 0 and b(θ) → b as θ → 1', () => {
    expect(denseWeights(0)).toEqual(Array<number>(S).fill(0));
    // θ = 1 itself short-circuits to the stored y₁, so approach it from below.
    denseWeights(1 - 1e-12).forEach((x, i) =>
      expect(Math.abs(x - b[i])).toBeLessThanOrEqual(1e-11),
    );
  });

  it('derivative of b(θ) at θ = 0 is e₁ and at θ = 1 is e₇ (C¹ across steps)', () => {
    const delta = 1e-6;
    const w0 = denseWeights(delta).map((x) => x / delta);
    const w1 = denseWeights(1 - delta).map((x, i) => (b[i] - x) / delta);
    w0.forEach((x, i) => expect(Math.abs(x - (i === 0 ? 1 : 0))).toBeLessThanOrEqual(1e-4));
    w1.forEach((x, i) => expect(Math.abs(x - (i === 6 ? 1 : 0))).toBeLessThanOrEqual(1e-4));
    expect(d[1]).toBe(0);
  });
});
