import { describe, expect, it } from 'vitest';
import { findRoot } from './roots';

function solve(g: (t: number) => number, a: number, b: number, tol?: number) {
  let calls = 0;
  const counted = (t: number) => {
    calls++;
    return g(t);
  };
  return { ...findRoot(counted, a, b, g(a), g(b), { tol }), calls };
}

describe('findRoot (Brent)', () => {
  it.each([
    ['t³ − 2t − 5 (Newton’s example)', (t: number) => t ** 3 - 2 * t - 5, 2, 3, 2.0945514815423265],
    ['cos t − t', (t: number) => Math.cos(t) - t, 0, 1, 0.7390851332151607],
    ['eᵗ − 10, bracket given reversed', (t: number) => Math.exp(t) - 10, 5, 0, Math.log(10)],
    ['steep tanh(1000(t − 0.3))', (t: number) => Math.tanh(1000 * (t - 0.3)), 0, 1, 0.3],
  ])('%s', (_name, g, a, b, root) => {
    const r = solve(g, a, b);
    expect(r.converged).toBe(true);
    expect(r.lo).toBeLessThanOrEqual(r.hi);
    expect(r.hi - r.lo).toBeLessThanOrEqual(1e-13 * Math.max(1, Math.abs(r.t)));
    expect(Math.abs(r.t - root)).toBeLessThanOrEqual(1e-13 * Math.max(1, root));
    expect(r.gLo * r.gHi).toBeLessThanOrEqual(0);
    expect(r.calls).toBeLessThanOrEqual(80);
  });

  it('converges superlinearly on smooth functions', () => {
    expect(solve((t) => Math.cos(t) - t, 0, 1).calls).toBeLessThanOrEqual(10);
  });

  it('the time tolerance scales with |t|', () => {
    const r = solve((t) => t - 1234567.891, 0, 2e6);
    expect(Math.abs(r.t - 1234567.891)).toBeLessThanOrEqual(1e-13 * 1234567.891);
  });

  it('returns an exact zero at an end of the bracket immediately', () => {
    const r = findRoot(
      () => {
        throw new Error('not called');
      },
      0,
      1,
      0,
      5,
    );
    expect(r).toMatchObject({ t: 0, lo: 0, hi: 0, converged: true, iterations: 0 });
    expect(findRoot((t) => t - 1, 0, 1, -1, 0).t).toBe(1);
  });

  it('reports non-convergence but keeps a valid bracket', () => {
    const g = (t: number) => Math.cos(t) - t;
    const r = findRoot(g, 0, 1, g(0), g(1), { maxIterations: 2 });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(2);
    expect(r.lo).toBeLessThanOrEqual(0.7390851332151607);
    expect(r.hi).toBeGreaterThanOrEqual(0.7390851332151607);
  });

  it.each([3, 5])(
    'a root of multiplicity %i: linear convergence, but always a valid bracket',
    (m) => {
      // Brent converges only linearly here (≈ 3× the bisection count), so a 1e-13 bracket can take
      // more than 80 evaluations; it must then say so. Such roots are ill-determined anyway: with
      // rounding noise δ in g the root is only known to ≈ δ^(1/m).
      const g = (t: number) => (t - 1) ** m;
      const capped = findRoot(g, 0, 3, g(0), g(3));
      expect(capped.lo).toBeLessThanOrEqual(1);
      expect(capped.hi).toBeGreaterThanOrEqual(1);
      expect(capped.converged).toBe(capped.hi - capped.lo <= 1e-13);
      const full = findRoot(g, 0, 3, g(0), g(3), { maxIterations: 1000 });
      expect(full.converged).toBe(true);
      expect(Math.abs(full.t - 1)).toBeLessThanOrEqual(1e-13);
    },
  );

  it('rejects brackets without a sign change and NaN values', () => {
    expect(() => findRoot((t) => t * t + 1, -1, 1, 2, 2)).toThrow(/no sign change/);
    expect(() => findRoot((t) => (t > 0.25 ? NaN : t - 0.5), 0, 1, -0.5, 0.5)).toThrow(/NaN/);
  });
});
