import { describe, expect, it } from 'vitest';
import type { AcceptedStep } from './dense';
import { type Dopri5Options, type OdeRhs, createDopri5 } from './dopri5';
import {
  type EventResult,
  type Guard,
  type GuardDirection,
  type LocateOptions,
  locateEvents,
} from './events';

/** Steps until the first event (or the end), as the hybrid simulator will. */
function firstEvent(
  f: OdeRhs,
  y0: number[],
  guards: Guard[],
  opts: Dopri5Options,
  locate?: LocateOptions,
): { event: EventResult | null; step?: AcceptedStep } {
  const stepper = createDopri5(f, 0, y0, opts);
  for (let r = stepper.step(); r.ok; r = stepper.step()) {
    const event = locateEvents(r.step, guards, locate);
    if (event) return { event, step: r.step };
  }
  return { event: null };
}

const guard = (id: string, direction: GuardDirection, fn: Guard['fn'], armed = true): Guard => ({
  id,
  direction,
  armed,
  fn,
});

/** A single step of size 1 on [0, 1] of y' = 0, for guards that depend on t only. */
function unitStep(): AcceptedStep {
  const stepper = createDopri5((_t, _y, dy) => (dy[0] = 0), 0, [0], { h0: 1, tEnd: 1 });
  const r = stepper.step();
  if (!r.ok) throw new Error(r.message);
  expect(r.step.t1).toBe(1);
  return r.step;
}

describe('locateEvents', () => {
  it('projectile hits the ground at the analytic time within 1e-12 relative', () => {
    // y(t) = h + v₀t − gt²/2 = 0  ⇒  t = (v₀ + √(v₀² + 2gh))/g
    const [h, v0, g] = [1.25, 3.1, 9.8];
    const ground = guard('ground', 'falling', (_t, y) => y[0]);
    const { event } = firstEvent((_t, y, dy) => ((dy[0] = y[1]), (dy[1] = -g)), [h, v0], [ground], {
      tEnd: 10,
    });
    const exact = (v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
    expect(event?.hits.map((x) => x.id)).toEqual(['ground']);
    expect(event?.hits[0].crossing).toBe('falling');
    expect(Math.abs((event?.t ?? NaN) / exact - 1)).toBeLessThanOrEqual(1e-12);
  });

  it('reports symmetric simultaneous crossings together, sorted by id, and nothing later', () => {
    // Two mirror-image particles: x₁ = t², x₂ = −t²; guards x₁ = 1 and x₂ = −1 cross at t = 1.
    const f: OdeRhs = (_t, y, dy) => {
      dy[0] = y[1];
      dy[1] = 2;
      dy[2] = y[3];
      dy[3] = -2;
    };
    const guards = [
      guard('right', 'rising', (_t, y) => y[0] - 1),
      guard('left', 'falling', (_t, y) => y[2] + 1),
      guard('later', 'rising', (_t, y) => y[0] - 1.0001),
    ];
    const { event } = firstEvent(f, [0, 0, 0, 0], guards, { tEnd: 3, h0: 0.7, hmax: 1.5 });
    expect(event?.hits.map((h) => h.id)).toEqual(['left', 'right']);
    expect(event?.hits.map((h) => h.index)).toEqual([1, 0]);
    for (const hit of event?.hits ?? []) expect(Math.abs(hit.t - 1)).toBeLessThanOrEqual(1e-12);
  });

  it('filters by direction', () => {
    // x = cos t falls through 0 at π/2 and rises through 0 at 3π/2.
    const f: OdeRhs = (_t, y, dy) => ((dy[0] = y[1]), (dy[1] = -y[0]));
    const at = (direction: GuardDirection) =>
      firstEvent(f, [1, 0], [guard('x', direction, (_t, y) => y[0])], { rtol: 1e-12, tEnd: 10 })
        .event;
    expect(Math.abs((at('falling')?.t ?? NaN) - Math.PI / 2)).toBeLessThan(1e-10);
    expect(at('falling')?.hits[0].crossing).toBe('falling');
    expect(Math.abs((at('rising')?.t ?? NaN) - (3 * Math.PI) / 2)).toBeLessThan(1e-10);
    expect(at('rising')?.hits[0].crossing).toBe('rising');
    expect(Math.abs((at('any')?.t ?? NaN) - Math.PI / 2)).toBeLessThan(1e-10);
  });

  it('catches two sign changes inside one step through the interior samples', () => {
    const step = unitStep();
    const g = (t: number) => (t - 0.3) * (t - 0.7); // positive at both ends of [0, 1]
    const falling = guard('dip', 'falling', (t) => g(t));
    const rising = guard('dip', 'rising', (t) => g(t));
    expect(Math.abs((locateEvents(step, [falling])?.t ?? NaN) - 0.3)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs((locateEvents(step, [rising])?.t ?? NaN) - 0.7)).toBeLessThanOrEqual(1e-13);
    // Without interior samples both roots are invisible: why the samples exist.
    expect(locateEvents(step, [falling], { samples: 0 })).toBeNull();
  });

  it('never evaluates or fires a disarmed guard', () => {
    let calls = 0;
    const step = unitStep();
    const off = guard('off', 'any', (t) => (calls++, t - 0.5), false);
    expect(locateEvents(step, [off])).toBeNull();
    const on = guard('on', 'any', (t) => t - 0.25);
    expect(locateEvents(step, [off, on])?.hits.map((h) => h.id)).toEqual(['on']);
    expect(calls).toBe(0);
  });

  it('does not re-trigger a guard that starts the step at exactly 0', () => {
    const step = unitStep();
    expect(locateEvents(step, [guard('leaves', 'any', (t) => t)])).toBeNull();
    // Starts at 0, dips below, then rises through 0 at t = 0.5: only that crossing counts.
    const event = locateEvents(step, [guard('dips', 'rising', (t) => t * (t - 0.5))]);
    expect(Math.abs((event?.t ?? NaN) - 0.5)).toBeLessThanOrEqual(1e-13);
  });

  it('a crossing exactly on a sample point fires once, at that point', () => {
    const step = unitStep(); // samples at 0, 0.2, 0.4, 0.6, 0.8, 1
    const event = locateEvents(step, [guard('s', 'rising', (t) => t - 0.4)]);
    expect(event?.t).toBe(0.4);
    expect(event?.hits).toHaveLength(1);
  });

  it('a crossing exactly at the step end belongs to that step, not to the next', () => {
    const stepper = createDopri5((_t, _y, dy) => (dy[0] = 1), 0, [0], {
      h0: 0.5,
      hmax: 0.5,
      tEnd: 1,
    });
    const g = guard('half', 'rising', (_t, y) => y[0] - 0.5);
    const hits: number[] = [];
    for (let r = stepper.step(); r.ok; r = stepper.step()) {
      const e = locateEvents(r.step, [g]);
      if (e) hits.push(e.t);
    }
    expect(hits).toEqual([0.5]);
  });

  it('finds the earliest crossing in the direction of integration when stepping backwards', () => {
    const stepper = createDopri5((_t, _y, dy) => (dy[0] = 0), 1, [0], { h0: -1, tEnd: 0 });
    const r = stepper.step();
    if (!r.ok) throw new Error(r.message);
    const event = locateEvents(r.step, [
      guard('a', 'any', (t) => t - 0.3),
      guard('b', 'any', (t) => t - 0.8),
    ]);
    expect(event?.hits.map((h) => h.id)).toEqual(['b']);
    expect(Math.abs((event?.t ?? NaN) - 0.8)).toBeLessThanOrEqual(1e-13);
  });

  it('rejects a guard that returns NaN', () => {
    expect(() => locateEvents(unitStep(), [guard('bad', 'any', () => NaN)])).toThrow(
      /"bad" returned NaN/,
    );
  });
});
