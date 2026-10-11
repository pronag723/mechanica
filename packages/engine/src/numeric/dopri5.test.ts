import { describe, expect, it } from 'vitest';
import { type AcceptedStep, evalDense, evalDenseDerivative } from './dense';
import { type Dopri5Options, type OdeRhs, createDopri5 } from './dopri5';
import { hairerInitialStep } from './dopri5-hinit';

/** Integrates to tEnd, collecting every accepted step; throws on any failure. */
function integrate(f: OdeRhs, t0: number, y0: number[], opts: Dopri5Options) {
  const stepper = createDopri5(f, t0, y0, opts);
  const steps: AcceptedStep[] = [];
  for (;;) {
    const r = stepper.step();
    if (r.ok) steps.push(r.step);
    else if (r.reason === 'end-reached') return { stepper, steps };
    else throw new Error(r.message);
  }
}

const decay: OdeRhs = (_t, y, dy) => {
  dy[0] = -y[0];
};
const oscillator: OdeRhs = (_t, y, dy) => {
  dy[0] = y[1];
  dy[1] = -y[0];
};

/** Arenstorf orbit (restricted three-body problem), Hairer–Nørsett–Wanner I, §II.0. */
const MU = 0.012277471;
// Nearest doubles to Hairer's T = 17.0652165601579625588917206249 and
// y₄(0) = −2.00158510637908252240537862224.
const ARENSTORF_T = 17.065216560157964;
const ARENSTORF_Y0 = [0.994, 0, 0, -2.0015851063790824];
const arenstorf: OdeRhs = (_t, y, dy) => {
  const mup = 1 - MU;
  const d1 = ((y[0] + MU) ** 2 + y[1] ** 2) ** 1.5;
  const d2 = ((y[0] - mup) ** 2 + y[1] ** 2) ** 1.5;
  dy[0] = y[2];
  dy[1] = y[3];
  dy[2] = y[0] + 2 * y[3] - (mup * (y[0] + MU)) / d1 - (MU * (y[0] - mup)) / d2;
  dy[3] = y[1] - 2 * y[2] - (mup * y[1]) / d1 - (MU * y[1]) / d2;
};

describe('DOPRI5 accuracy', () => {
  it("y' = −y to t = 10 with rtol 1e-10: relative error ≤ 1e-9", () => {
    const { stepper } = integrate(decay, 0, [1], { rtol: 1e-10, atol: 1e-16, tEnd: 10 });
    expect(stepper.t).toBe(10);
    expect(Math.abs(stepper.y[0] / Math.exp(-10) - 1)).toBeLessThanOrEqual(1e-9);
  });

  it('harmonic oscillator, 100 periods: phase error and energy drift < 1e-8', () => {
    const T = 200 * Math.PI;
    const { stepper } = integrate(oscillator, 0, [1, 0], { rtol: 1e-11, atol: 1e-13, tEnd: T });
    const [x, v] = stepper.y;
    // Exact: x = cos t, v = −sin t; phase atan2(−v, x) = t ≡ 0 (mod 2π) at t = 100·2π.
    expect(Math.abs(Math.atan2(-v, x))).toBeLessThan(1e-8);
    expect(Math.abs((x * x + v * v) / 2 - 0.5) / 0.5).toBeLessThan(1e-8);
  });

  it.each([Infinity, 0.1, 0.01])(
    "constant acceleration x'' = a is exact to 1e-13 at every dense point (hmax = %f)",
    (hmax) => {
      const [x0, v0, a] = [1.5, 2, 3.7]; // x, v > 0 on [0, 5], so relative errors are defined
      const { steps } = integrate((_t, y, dy) => ((dy[0] = y[1]), (dy[1] = a)), 0, [x0, v0], {
        tEnd: 5,
        hmax,
      });
      const out = new Float64Array(2);
      let worst = 0;
      for (const s of steps) {
        for (let j = 0; j <= 20; j++) {
          const t = j === 20 ? s.t1 : s.t0 + (j / 20) * (s.t1 - s.t0);
          evalDense(s, t, out);
          const x = x0 + v0 * t + (a * t * t) / 2;
          const v = v0 + a * t;
          worst = Math.max(worst, Math.abs(out[0] / x - 1), Math.abs(out[1] / v - 1));
        }
      }
      expect(worst).toBeLessThanOrEqual(1e-13);
    },
  );

  it('Arenstorf orbit returns to its initial point after one period', () => {
    const { stepper } = integrate(arenstorf, 0, ARENSTORF_Y0, {
      rtol: 1e-12,
      atol: 1e-12,
      tEnd: ARENSTORF_T,
    });
    const err = Math.max(...ARENSTORF_Y0.map((v, i) => Math.abs(stepper.y[i] - v)));
    console.log(
      `Arenstorf, tol 1e-12: max |y(T) − y(0)| = ${err.toExponential(2)}, ` +
        `${stepper.stats.nfev} RHS evaluations, ${stepper.stats.naccept} accepted, ${stepper.stats.nreject} rejected`,
    );
    expect(err).toBeLessThan(1e-7);
  });

  it.each([1e-4, 1e-6, 1e-8])(
    "dense output at mid-step on y' = −y is within 10·rtol (rtol %f)",
    (rtol) => {
      const { steps } = integrate(decay, 0, [1], { rtol, atol: rtol * 1e-3, tEnd: 10 });
      const out = new Float64Array(1);
      for (const s of steps) {
        const tm = (s.t0 + s.t1) / 2;
        expect(Math.abs(evalDense(s, tm, out)[0] / Math.exp(-tm) - 1)).toBeLessThanOrEqual(
          10 * rtol,
        );
      }
    },
  );

  it("polynomials: a step is exact for y' = 5t⁴, the dense output for y' = 4t³", () => {
    const out = new Float64Array(1);
    const p5 = integrate((t, _y, dy) => (dy[0] = 5 * t ** 4), 0, [0], {
      h0: 0.5,
      hmax: 0.5,
      tEnd: 2,
    });
    for (const s of p5.steps)
      expect(Math.abs(s.data[s.offset + 5] - s.t1 ** 5)).toBeLessThanOrEqual(1e-14 * 32);
    const p4 = integrate((t, _y, dy) => (dy[0] = 4 * t ** 3), 0, [0], {
      h0: 0.5,
      hmax: 0.5,
      tEnd: 2,
    });
    for (const s of p4.steps) {
      for (let j = 0; j <= 10; j++) {
        const t = s.t0 + (j / 10) * (s.t1 - s.t0);
        expect(Math.abs(evalDense(s, t, out)[0] - t ** 4)).toBeLessThanOrEqual(1e-14 * 16);
      }
    }
  });

  it('dense derivative equals f at both step ends and approximates y′ inside', () => {
    const { steps } = integrate(oscillator, 0, [1, 0], { rtol: 1e-9, tEnd: 10 });
    const d = new Float64Array(2);
    const y = new Float64Array(2);
    for (const s of steps) {
      for (const t of [s.t0, s.t1]) {
        evalDense(s, t, y);
        evalDenseDerivative(s, t, d);
        expect(Math.abs(d[0] - y[1])).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(d[1] + y[0])).toBeLessThanOrEqual(1e-12);
      }
      const tm = (s.t0 + s.t1) / 2;
      evalDenseDerivative(s, tm, d);
      expect(Math.abs(d[0] + Math.sin(tm))).toBeLessThanOrEqual(1e-7);
    }
  });
});

describe('DOPRI5 stepping API', () => {
  it('lands exactly on tEnd, never past it, then reports end-reached', () => {
    const { stepper, steps } = integrate(decay, 0, [1], { tEnd: 0.7 });
    expect(steps.at(-1)?.t1).toBe(0.7);
    expect(steps.every((s) => s.t1 <= 0.7 && s.t1 > s.t0)).toBe(true);
    for (let i = 1; i < steps.length; i++) expect(steps[i].t0).toBe(steps[i - 1].t1);
    expect(stepper.done).toBe(true);
    const r = stepper.step();
    expect(r.ok === false && r.reason).toBe('end-reached');
  });

  it('integrates backwards when tEnd < t0', () => {
    const { stepper, steps } = integrate(decay, 1, [Math.exp(-1)], {
      rtol: 1e-12,
      atol: 1e-16,
      tEnd: -1,
    });
    expect(stepper.t).toBe(-1);
    expect(steps.every((s) => s.h < 0)).toBe(true);
    expect(Math.abs(stepper.y[0] / Math.E - 1)).toBeLessThanOrEqual(1e-11);
  });

  it('each step and each dense end state is bit-identical to the stepper state (C⁰ across steps)', () => {
    const stepper = createDopri5(oscillator, 0, [1, 0], { tEnd: 3 });
    const out = new Float64Array(2);
    let prev: AcceptedStep | undefined;
    for (let r = stepper.step(); r.ok; r = stepper.step()) {
      expect(evalDense(r.step, r.step.t1, out)).toEqual(stepper.y);
      if (prev)
        expect(evalDense(r.step, r.step.t0, new Float64Array(2))).toEqual(
          evalDense(prev, prev.t1, new Float64Array(2)),
        );
      prev = r.step;
    }
  });

  it('FSAL: 6 RHS evaluations per attempt, plus 2 at the start (f(t₀, y₀) and HINIT)', () => {
    const { stepper } = integrate(arenstorf, 0, ARENSTORF_Y0, {
      rtol: 1e-6,
      atol: 1e-6,
      tEnd: ARENSTORF_T,
    });
    const { nfev, nsteps, naccept, nreject } = stepper.stats;
    expect(nreject).toBeGreaterThan(0);
    expect(nsteps).toBe(naccept + nreject);
    expect(nfev).toBe(6 * nsteps + 2);
  });

  it('respects hmax and h0', () => {
    const { steps } = integrate(decay, 0, [1], { tEnd: 1, hmax: 0.03, h0: 0.001 });
    expect(steps[0].h).toBe(0.001);
    expect(steps.every((s) => Math.abs(s.h) <= 0.03)).toBe(true);
  });

  it('restart drops FSAL and continues from a modified state with a new RHS', () => {
    // A piecewise RHS switched by the caller, as the hybrid simulator does at events.
    let slope = 1;
    const stepper = createDopri5((_t, _y, dy) => (dy[0] = slope), 0, [0], { tEnd: 1 });
    while (stepper.step().ok);
    expect(stepper.y[0]).toBeCloseTo(1, 14);
    slope = -2;
    const nfev = stepper.stats.nfev;
    stepper.restart(1, [5], { h: 0.25, tEnd: 2 });
    expect(stepper.stats.nfev).toBe(nfev + 1); // f(t, y) re-evaluated; the hint skips HINIT
    expect(stepper.done).toBe(false);
    const r = stepper.step();
    expect(r.ok && r.step.h).toBe(0.25);
    while (stepper.step().ok);
    expect(stepper.t).toBe(2);
    expect(stepper.y[0]).toBeCloseTo(3, 14);
  });

  it('per-component atol', () => {
    const { stepper } = integrate(oscillator, 0, [1, 0], { atol: [1e-12, 1e-6], rtol: 0, tEnd: 1 });
    expect(Math.abs(stepper.y[0] - Math.cos(1))).toBeLessThan(1e-9);
    expect(() => createDopri5(oscillator, 0, [1, 0], { atol: [1e-12] })).toThrow(RangeError);
    expect(() => createDopri5(oscillator, 0, [1, 0], { atol: 0 })).toThrow(RangeError);
  });

  it('fails with step-size-too-small at a finite-time blow-up', () => {
    // y' = y², y(0) = 1: y = 1/(1 − t) blows up at t = 1.
    const stepper = createDopri5((_t, y, dy) => (dy[0] = y[0] * y[0]), 0, [1], {
      tEnd: 2,
      hmin: 1e-10,
    });
    let r = stepper.step();
    while (r.ok) r = stepper.step();
    expect(r.reason).toBe('step-size-too-small');
    expect(r.t).toBeGreaterThan(0.99);
    expect(r.t).toBeLessThan(1);
    expect(r.message).toMatch(/step size .* too small at t = /);
  });

  it('fails with non-finite when f is undefined beyond some t, or at the start', () => {
    const stepper = createDopri5((t, _y, dy) => (dy[0] = Math.sqrt(1 - t)), 0, [0], { tEnd: 2 });
    let r = stepper.step();
    while (r.ok) r = stepper.step();
    expect(r.reason).toBe('non-finite');
    expect(r.t).toBeGreaterThan(0.999);
    // y' = 1e307 ignores y, so the error estimate stays finite while y₁ overflows (y passes
    // Number.MAX_VALUE ≈ 1.797e308 at t ≈ 17.97). An infinite state must never be accepted; the
    // run must fail there instead of "succeeding" to tEnd with y = ∞.
    const overflow = createDopri5((_t, _y, dy) => (dy[0] = 1e307), 0, [0], { tEnd: 100, h0: 0.01 });
    let ro = overflow.step();
    while (ro.ok) {
      expect(Number.isFinite(overflow.y[0])).toBe(true);
      ro = overflow.step();
    }
    expect(ro.reason).toBe('non-finite');
    expect(ro.t).toBeGreaterThan(17);
    expect(ro.t).toBeLessThan(17.98);
    const bad = createDopri5((_t, _y, dy) => (dy[0] = NaN), 0, [0], { tEnd: 1 });
    const r0 = bad.step();
    expect(r0.ok === false && r0.reason).toBe('non-finite');
  });

  it('fails with max-steps', () => {
    const stepper = createDopri5(oscillator, 0, [1, 0], { tEnd: 100, maxSteps: 10 });
    let r = stepper.step();
    let accepted = 0;
    while (r.ok) {
      accepted++;
      r = stepper.step();
    }
    expect(r.reason).toBe('max-steps');
    expect(accepted).toBeLessThanOrEqual(10);
  });

  it('is deterministic: two runs are bit-identical', () => {
    const run = () =>
      integrate(arenstorf, 0, ARENSTORF_Y0, { rtol: 1e-8, atol: 1e-8, tEnd: 5 }).steps;
    const a = run();
    const b = run();
    expect(b.length).toBe(a.length);
    const out1 = new Float64Array(4);
    const out2 = new Float64Array(4);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].h).toBe(a[i].h);
      expect(evalDense(b[i], (b[i].t0 + b[i].t1) / 2, out2)).toEqual(
        evalDense(a[i], (a[i].t0 + a[i].t1) / 2, out1),
      );
    }
  });

  it("HINIT matches the hand computation for y' = −y, y₀ = 1, rtol = atol = 1e-6", () => {
    // sk = 2e-6, ‖f₀‖ = ‖y₀‖ = 5e5 → h₀ = 0.01; Euler: f₁ − f₀ = 0.01 → ‖y''‖ = 5e5;
    // h₁ = (0.01 / 5e5)^(1/5) = (2e-8)^(1/5); h = min(100·h₀, h₁) = h₁.
    const h = hairerInitialStep(
      decay,
      0,
      Float64Array.of(1),
      Float64Array.of(-1),
      1,
      Infinity,
      1e-6,
      Float64Array.of(1e-6),
      new Float64Array(1),
      new Float64Array(1),
    );
    expect(h).toBeCloseTo(2e-8 ** 0.2, 14);
  });
});

describe('DOPRI5 performance', () => {
  it('100 oscillator periods at rtol 1e-10 take < 50 ms', () => {
    const run = () =>
      integrate(oscillator, 0, [1, 0], { rtol: 1e-10, atol: 1e-12, tEnd: 200 * Math.PI });
    run(); // warm-up: let the JIT compile the stepper before timing
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    const t0 = performance.now();
    const { stepper } = run();
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    const ms = performance.now() - t0;
    console.log(
      `DOPRI5: 100 oscillator periods, rtol 1e-10: ${ms.toFixed(1)} ms, ${stepper.stats.naccept} steps`,
    );
    expect(ms).toBeLessThan(50);
  });
});
