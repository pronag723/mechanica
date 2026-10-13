/**
 * The hybrid simulator on the Phase 0 scenes (prompt 03), against the oracle's expected.json:
 * class `exact` at 1e-9 relative, class `ode` at 1e-7.
 */
import { describe, expect, it } from 'vitest';
import t01Json from '../../../tests/scenes/engine/t01_atwood.json';
import t02Json from '../../../tests/scenes/engine/t02_table.json';
import x01Json from '../../../tests/scenes/engine/x01_block_slides_to_stop.json';
import x02Json from '../../../tests/scenes/engine/x02_pushed_block.json';
import x03Json from '../../../tests/scenes/engine/x03_whirl_slack.json';
import { stringLength } from '../src/constraints/string';
import type { StringConstraint } from '../src/model/types';
import { simulate } from '../src/sim/simulate';
import { forcesAt, probeValue, sampleProbe, stateAt } from '../src/sim/trajectory';
import type { Trajectory } from '../src/sim/types';
import { createRng } from './helpers/prng';
import { compileOrThrow, expectedValue, loadScene, relErr, variantSpec } from './helpers/scenes';

const EXACT = 1e-9;
const ODE = 1e-7;
const t01 = loadScene(t01Json);
const t02 = loadScene(t02Json);
const x01 = loadScene(x01Json);
const x02 = loadScene(x02Json);
const x03 = loadScene(x03Json);

function close(actual: number, scene: string, key: string, tol: number, sign = 1): void {
  const e = sign * expectedValue(scene, key);
  expect(relErr(actual, e), `${scene}.${key}: ${actual} vs ${e}`).toBeLessThanOrEqual(tol);
}

/** No two events closer than 1e-9 s (re-trigger protection). */
function expectNoDuplicates(traj: Trajectory): void {
  for (let i = 1; i < traj.events.length; i++) {
    const [p, e] = [traj.events[i - 1], traj.events[i]];
    expect(e.t - p.t, `${p.kind}@${p.t} then ${e.kind}@${e.t}`).toBeGreaterThan(1e-9);
  }
}

describe('t01 Atwood machine', () => {
  const model = compileOrThrow(t01.spec);
  const traj = simulate(model);

  it('the query "m₁ displaced by −1 m along y" hits at 1.0101525… s with the textbook speed', () => {
    expect(traj.endReason).toBe('horizon');
    const hits = traj.queries.m1_down_1m;
    expect(hits).toHaveLength(1);
    close(hits[0].t, 't01_atwood', 't_m1_down_1m', EXACT);
    expect(Math.abs(hits[0].value + 1)).toBeLessThan(1e-12);
    const speed = probeValue(model, traj, { kind: 'bodySpeed', body: 'm1' }, hits[0].t);
    close(speed, 't01_atwood', 'v_m1_down_1m', EXACT);
    expect(traj.events.map((e) => e.kind)).toEqual(['query']);
    expect(traj.events[0]).toMatchObject({ phaseBefore: 0, phaseAfter: 0, ids: ['m1_down_1m'] });
  });

  it('one uniform phase: tension and accelerations constant', () => {
    expect(traj.phases).toHaveLength(1);
    expect(traj.phases[0].uniform).toBe(true);
    for (const t of [0, 0.3, 0.77, 1.2]) {
      close(forcesAt(model, traj, t).lambda.string, 't01_atwood', 'T', EXACT);
      close(
        probeValue(model, traj, { kind: 'stringTension', string: 'string' }, t),
        't01_atwood',
        'T',
        EXACT,
      );
      close(
        probeValue(model, traj, { kind: 'bodyAcceleration', body: 'm1', component: 'y' }, t),
        't01_atwood',
        'a',
        EXACT,
        -1,
      );
    }
  });

  it('positions at 50 random dense times match the analytic quadratic within 1e-12', () => {
    const rng = createRng(301);
    const a = expectedValue('t01_atwood', 'a');
    for (let k = 0; k < 50; k++) {
      const t = rng.uniform(0, 1.2);
      const { q, v } = stateAt(traj, t);
      expect(Math.abs(q[1] - (-2 - (a * t * t) / 2))).toBeLessThan(1e-12);
      expect(Math.abs(q[3] - (-2 + (a * t * t) / 2))).toBeLessThan(1e-12);
      expect(q[0]).toBe(-0.25);
      expect(q[2]).toBe(0.25);
      expect(Math.abs(v[1] + a * t)).toBeLessThan(1e-12);
    }
  });
});

describe('t02b table + hanging mass, kinetic friction', () => {
  const model = compileOrThrow(variantSpec(t02, 't02b_table_kinetic'));
  const traj = simulate(model);
  const TOP = 'c:A:table:2';

  it('slides for the whole horizon (A stays clear of the pulley) with constant a, T, N, F_fr', () => {
    expect(traj.endReason).toBe('horizon');
    expect(traj.events).toEqual([]);
    expect(traj.phases).toHaveLength(1);
    expect(traj.phases[0].mode).toEqual({
      active: [TOP, 'string'],
      friction: { [TOP]: 'slipPos' },
    });
    expect(traj.phases[0].uniform).toBe(true);
    const id = 't02b_table_kinetic';
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      close(
        probeValue(model, traj, { kind: 'bodyAcceleration', body: 'A', component: 'x' }, t),
        id,
        'a',
        EXACT,
      );
      close(
        probeValue(model, traj, { kind: 'stringTension', string: 'string' }, t),
        id,
        'T',
        EXACT,
      );
      close(probeValue(model, traj, { kind: 'contactNormal', contact: TOP }, t), id, 'N', EXACT);
      close(
        probeValue(model, traj, { kind: 'contactFriction', contact: TOP }, t),
        id,
        'F_fr',
        EXACT,
        -1,
      );
    }
    // A's right edge stays left of the table's edge, the hanging block clear of the pulley.
    expect(stateAt(traj, 1).q[0] + 0.25).toBeLessThan(-1.5);
  });
});

describe('t02c table + hanging mass, static friction holds', () => {
  const model = compileOrThrow(variantSpec(t02, 't02c_table_static'));
  const traj = simulate(model);

  it('is at rest from t = 0 with F_fr = 9.8 N (not μs·N)', () => {
    expect(traj.atRestFrom).toBe(0);
    expect(traj.events).toEqual([]);
    expect(traj.phases).toHaveLength(1);
    expect(traj.phases[0].mode.friction['c:A:table:2']).toBe('stick');
    const id = 't02c_table_static';
    for (const t of [0, 0.5, 1]) {
      close(
        probeValue(model, traj, { kind: 'contactFriction', contact: 'c:A:table:2' }, t),
        id,
        'F_fr',
        EXACT,
        -1,
      );
      close(
        probeValue(model, traj, { kind: 'stringTension', string: 'string' }, t),
        id,
        'T',
        EXACT,
      );
      expect(Array.from(stateAt(traj, t).q)).toEqual(Array.from(model.q0));
    }
  });
});

describe('x01 block slides to a stop', () => {
  const model = compileOrThrow(x01.spec);
  const traj = simulate(model);
  const C = 'c:A:floor:0';
  const id = 'x01_block_slides_to_stop';

  it('stopOrReverse, then stick at 1.020408… after a path of 1.020408…, at rest with no further events', () => {
    expect(traj.events.map((e) => e.kind)).toEqual(['stopOrReverse']);
    const ev = traj.events[0];
    close(ev.t, id, 't_stop', EXACT);
    expect(ev).toMatchObject({ ids: [C], phaseBefore: 0, phaseAfter: 1 });
    expect(traj.phases.map((p) => p.mode.friction[C])).toEqual(['slipPos', 'stick']);
    expect(traj.atRestFrom).toBe(ev.t);
    expect(traj.endReason).toBe('horizon');
    expect(traj.tEnd).toBe(2);
    for (const t of [ev.t, 1.5, 2]) {
      close(probeValue(model, traj, { kind: 'bodyPathLength', body: 'A' }, t), id, 's_stop', EXACT);
      close(
        probeValue(model, traj, { kind: 'bodyDisplacement', body: 'A', axis: 'x' }, t),
        id,
        's_stop',
        EXACT,
      );
    }
    // The snap: v is exactly 0 after the event; before it, the dense state has v ≈ 0.
    expect(Array.from(stateAt(traj, ev.t).v)).toEqual([0, 0]);
    expect(Math.abs(stateAt(traj, ev.t, 'before').v[0])).toBeLessThan(1e-12);
  });

  it('slides with a = −μk·g, N = M·g, F_fr = −μk·M·g', () => {
    for (const t of [0, 0.5, 1]) {
      close(
        probeValue(model, traj, { kind: 'bodyAcceleration', body: 'A', component: 'x' }, t),
        id,
        'a',
        EXACT,
      );
      close(probeValue(model, traj, { kind: 'contactNormal', contact: C }, t), id, 'N', EXACT);
      close(probeValue(model, traj, { kind: 'contactFriction', contact: C }, t), id, 'F_fr', EXACT);
    }
    expect(probeValue(model, traj, { kind: 'contactFriction', contact: C }, 1.5)).toBe(0);
    expect(traj.phases.every((p) => p.uniform)).toBe(true);
  });
});

describe('x02 pushed block: initial mode selection', () => {
  it('x02a: F < μs·N, stick with F_fr = −1.5 N, at rest', () => {
    const model = compileOrThrow(variantSpec(x02, 'x02a_force_below_static'));
    const traj = simulate(model);
    const id = 'x02a_force_below_static';
    expect(traj.phases[0].mode.friction['c:A:floor:0']).toBe('stick');
    expect(traj.atRestFrom).toBe(0);
    expect(traj.events).toEqual([]);
    close(
      probeValue(model, traj, { kind: 'contactFriction', contact: 'c:A:floor:0' }, 0),
      id,
      'F_fr',
      EXACT,
    );
    close(
      probeValue(model, traj, { kind: 'contactNormal', contact: 'c:A:floor:0' }, 0),
      id,
      'N',
      EXACT,
    );
    expect(traj.diagnostics).toEqual([]);
  });

  it('x02b: F > μs·N, slips from t = 0 with a = 1.52 (no re-trigger of v_t = 0 at the start)', () => {
    const model = compileOrThrow(variantSpec(x02, 'x02b_force_above_static'));
    const traj = simulate(model);
    const id = 'x02b_force_above_static';
    expect(traj.phases).toHaveLength(1);
    expect(traj.phases[0].mode.friction['c:A:floor:0']).toBe('slipPos');
    expect(traj.events).toEqual([]);
    for (const t of [0, 0.5, 1]) {
      close(
        probeValue(model, traj, { kind: 'bodyAcceleration', body: 'A', component: 'x' }, t),
        id,
        'a',
        EXACT,
      );
      close(
        probeValue(model, traj, { kind: 'contactFriction', contact: 'c:A:floor:0' }, t),
        id,
        'F_fr',
        EXACT,
      );
    }
    expect(traj.diagnostics).toEqual([]);
  });
});

describe('x03 whirl on a string: nonlinear constraint, slack, free flight', () => {
  const model = compileOrThrow(x03.spec);
  const traj = simulate(model);
  const id = 'x03_whirl_slack';
  const str = model.constraints[model.constraintIndex.get('string') ?? -1] as StringConstraint;

  it('goes slack where cos φ = −0.557823…, at speed 2.33809…', () => {
    expect(traj.events.map((e) => e.kind)).toEqual(['slack', 'taut']);
    const slack = traj.events[0];
    close(slack.t, id, 't_slack', ODE);
    const { q } = stateAt(traj, slack.t, 'before');
    const r = Math.hypot(q[0], q[1]);
    close(-q[1] / r, id, 'cos_phi_slack', ODE);
    close(q[1] + 1, id, 'h_slack', ODE);
    close(
      probeValue(model, traj, { kind: 'bodySpeed', body: 'm' }, slack.t, 'before'),
      id,
      'v_slack',
      ODE,
    );
    // Path along the circle: L·φ with L = 1.
    const phi = Math.acos(expectedValue(id, 'cos_phi_slack'));
    expect(
      relErr(probeValue(model, traj, { kind: 'bodyPathLength', body: 'm' }, slack.t), phi),
    ).toBeLessThan(ODE);
    expect(probeValue(model, traj, { kind: 'stringTension', string: 'string' }, slack.t)).toBe(0);
  });

  it('keeps the constraint residual below 1e-10 before the event', () => {
    const p0 = traj.phases[0];
    let worst = 0;
    for (let k = 0; k <= 400; k++) {
      const t = p0.tStart + ((p0.tEnd - p0.tStart) * k) / 400;
      worst = Math.max(
        worst,
        Math.abs(str.restLength - stringLength(str, stateAt(traj, t, 'before').q)),
      );
    }
    expect(worst).toBeLessThan(1e-10);
    expect(traj.stats.maxProjection).toBeGreaterThan(0);
    expect(traj.stats.maxProjection).toBeLessThan(1e-10);
  });

  it('flies freely after slack until the taut guard ends the run (impactNotImplemented)', () => {
    expect(traj.phases.map((p) => p.mode.active)).toEqual([['string'], []]);
    expect(traj.endReason).toBe('impactNotImplemented');
    const taut = traj.events[1];
    expect(taut).toMatchObject({ ids: ['string'], phaseBefore: 1, phaseAfter: -1 });
    expect(taut.data.rate).toBeLessThan(0);
    expect(traj.tEnd).toBe(taut.t);
    const { q } = stateAt(traj, taut.t, 'before');
    expect(Math.abs(Math.hypot(q[0], q[1]) - 1)).toBeLessThan(1e-12);
    // Free flight is a parabola: a = g exactly.
    expect(
      probeValue(model, traj, { kind: 'bodyAcceleration', body: 'm', component: 'y' }, 1),
    ).toBe(-9.8);
    expect(traj.phases[1].uniform).toBe(true);
  });

  it('samples probes across the phases', () => {
    const s = sampleProbe(model, traj, { kind: 'totalEnergy' }, 101);
    expect(s.t[0]).toBe(0);
    expect(s.t[100]).toBe(traj.tEnd);
    const e0 = 0.5 * 36 - 9.8; // KE − m·g·p with g·p = (−9.8)·(−1)
    for (const e of s.values) expect(Math.abs(e - e0) / e0).toBeLessThan(1e-9);
  });
});

describe('re-trigger protection', () => {
  it('no duplicate events in any scene', () => {
    const specs = [
      t01.spec,
      variantSpec(t02, 't02a_table_frictionless'),
      variantSpec(t02, 't02b_table_kinetic'),
      variantSpec(t02, 't02c_table_static'),
      x01.spec,
      variantSpec(x02, 'x02a_force_below_static'),
      variantSpec(x02, 'x02b_force_above_static'),
      x03.spec,
    ];
    for (const spec of specs) expectNoDuplicates(simulate(compileOrThrow(spec)));
  });
});
