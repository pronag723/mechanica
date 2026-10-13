/**
 * Simulator behaviour beyond the textbook values (prompt 03): plain-data trajectories,
 * determinism, performance, the initial state (projection, slack strings, indeterminate supports),
 * terminal geometry and queries.
 */
import { describe, expect, it } from 'vitest';
import t01Json from '../../../tests/scenes/engine/t01_atwood.json';
import t14Json from '../../../tests/scenes/engine/t14_two_strings.json';
import x01Json from '../../../tests/scenes/engine/x01_block_slides_to_stop.json';
import x03Json from '../../../tests/scenes/engine/x03_whirl_slack.json';
import { compileModel } from '../src/model/compile';
import { simulate } from '../src/sim/simulate';
import { phaseAt, probeValue, sampleProbe, stateAt } from '../src/sim/trajectory';
import type { Trajectory } from '../src/sim/types';
import type { ModelSpec } from '../src/spec';
import { compileOrThrow, expectedValue, loadScene, relErr, variantSpec } from './helpers/scenes';

const t01 = loadScene(t01Json);
const t14 = loadScene(t14Json);
const x01 = loadScene(x01Json);
const x03 = loadScene(x03Json);

/** Bit-exact serialization: typed arrays as their bytes. */
function bits(traj: Trajectory): string {
  return JSON.stringify(traj, (_k, v: unknown) =>
    v instanceof Float64Array
      ? Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
      : v,
  );
}

describe('the Trajectory is plain data', () => {
  it('survives structuredClone, and the sampling functions work on the clone', () => {
    for (const spec of [t01.spec, x01.spec, x03.spec]) {
      const model = compileOrThrow(spec);
      const traj = simulate(model);
      const clone = structuredClone(traj);
      expect(clone).toEqual(traj);
      expect(bits(clone)).toBe(bits(traj));
      for (const probe of [
        { kind: 'bodyPathLength', body: model.bodies[0].id },
        { kind: 'kineticEnergy' },
      ] as const) {
        const a = sampleProbe(model, traj, probe, 37);
        const b = sampleProbe(model, clone, probe, 37);
        expect(Array.from(b.values)).toEqual(Array.from(a.values));
      }
    }
  });
});

describe('determinism', () => {
  it('identical runs give bit-identical trajectories', () => {
    for (const spec of [t01.spec, x01.spec, x03.spec]) {
      const model = compileOrThrow(spec);
      expect(bits(simulate(model))).toBe(bits(simulate(model)));
    }
  });
});

describe('performance', () => {
  it('t01 and x01 each run under 20 ms (warm)', () => {
    for (const [name, spec] of [
      ['t01', t01.spec],
      ['x01', x01.spec],
    ] as const) {
      const model = compileOrThrow(spec);
      simulate(model); // warm-up
      const runs = 20;
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        // eslint-disable-next-line no-restricted-globals -- benchmark timing
        const t0 = performance.now();
        simulate(model);
        // eslint-disable-next-line no-restricted-globals -- benchmark timing
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const median = times[runs >> 1];
      console.log(`${name}: median ${median.toFixed(3)} ms, max ${times[runs - 1].toFixed(3)} ms`);
      expect(median).toBeLessThan(20);
    }
  });
});

describe('initial state', () => {
  it('projects initial velocities that violate an active string, and says so', () => {
    const spec = {
      ...t01.spec,
      bodies: t01.spec.bodies.map((b) => (b.id === 'm1' ? { ...b, velocity: { x: 0, y: -1 } } : b)),
    };
    const model = compileOrThrow(spec);
    const traj = simulate(model);
    const d = traj.diagnostics.find((x) => x.code === 'INITIAL_VELOCITY_PROJECTED');
    expect(d?.severity).toBe('warning');
    expect(d?.params.bodies).toEqual(['m1', 'm2']);
    // M-metric projection: the common speed conserves momentum along the string, 3·1/(3 + 2).
    const v = stateAt(traj, 0).v;
    expect(v[1]).toBeCloseTo(-0.6, 15);
    expect(v[3]).toBeCloseTo(0.6, 15);
    // m₂ then rises into the pulley rim: a terminal event, at the root of 0.98t² + 0.6t − 1.875.
    expect(traj.endReason).toBe('terminal');
    const t = (-0.6 + Math.sqrt(0.36 + 4 * 0.98 * 1.875)) / (2 * 0.98);
    expect(relErr(traj.tEnd, t)).toBeLessThan(1e-9);
    expect(traj.events.at(-1)).toMatchObject({ kind: 'terminal', ids: ['string'], phaseAfter: -1 });
  });

  it('a string opening at t₀ starts slack; it goes taut again at t = 2v/g', () => {
    const spec = {
      ...t01.spec,
      bodies: t01.spec.bodies.map((b) => ({ ...b, velocity: { x: 0, y: 1 } })),
    };
    const traj = simulate(compileOrThrow(spec));
    expect(traj.phases[0].mode.active).toEqual([]);
    expect(traj.events.map((e) => e.kind)).toEqual(['taut']);
    expect(relErr(traj.tEnd, 2 / 9.8)).toBeLessThan(1e-9);
    expect(traj.diagnostics).toEqual([]);
  });

  it('statically indeterminate supports: three strings hold the mass, flagged, motion exact', () => {
    const model = compileOrThrow(variantSpec(t14, 'three_strings'));
    const traj = simulate(model, { horizon: 5 });
    expect(traj.endReason).toBe('horizon');
    expect(traj.events).toEqual([]);
    expect(traj.phases[0].mode.active).toEqual(['s30', 's60', 's90']);
    expect(traj.phases[0].indeterminate).toBe(true);
    expect(traj.diagnostics.map((d) => d.code).sort()).toEqual([
      'BOUNDARY_CASE',
      'STATICALLY_INDETERMINATE',
    ]);
    const q = stateAt(traj, 5).q;
    expect(Math.abs(q[0] - model.q0[0]) + Math.abs(q[1] - model.q0[1])).toBeLessThan(1e-12);
  });
});

describe('queries', () => {
  it('max/min use the analytic rate: the apex of the free flight after slack (x03)', () => {
    const spec: ModelSpec = {
      ...x03.spec,
      queries: [
        {
          id: 'top',
          probe: { kind: 'bodyPosition', body: 'm', component: 'y' },
          condition: { kind: 'max' },
        },
        {
          id: 'xMax',
          probe: { kind: 'bodyPosition', body: 'm', component: 'x' },
          condition: { kind: 'max' },
        },
        {
          id: 'vyMin',
          probe: { kind: 'bodyVelocity', body: 'm', component: 'y' },
          condition: { kind: 'min' },
        },
        {
          id: 'Tmax',
          probe: { kind: 'stringTension', string: 'string' },
          condition: { kind: 'max' },
        },
      ],
    };
    const model = compileOrThrow(spec);
    const traj = simulate(model);
    const c = expectedValue('x03_whirl_slack', 'cos_phi_slack');
    const v = expectedValue('x03_whirl_slack', 'v_slack');
    const s = Math.sqrt(1 - c * c);
    // At slack: position (sin φ, −cos φ), velocity v·(cos φ, sin φ); then a parabola.
    const apex = -c + (v * s) ** 2 / (2 * 9.8);
    const tops = traj.queries.top;
    expect(tops).toHaveLength(1);
    expect(relErr(tops[0].value, apex)).toBeLessThan(1e-7);
    expect(
      Math.abs(
        probeValue(model, traj, { kind: 'bodyVelocity', body: 'm', component: 'y' }, tops[0].t),
      ),
    ).toBeLessThan(1e-9);
    // On the circle x = L·sin φ is greatest at φ = 90°: exactly L = 1.
    expect(traj.queries.xMax).toHaveLength(1);
    expect(relErr(traj.queries.xMax[0].value, 1)).toBeLessThan(1e-7);
    // v_y = v·sin φ only grows to φ = 90° and then falls: no interior minimum before the end.
    expect(traj.queries.vyMin).toEqual([]);
    expect(traj.queries.Tmax).toEqual([]);
    const d = traj.diagnostics.find((x) => x.code === 'QUERY_UNSUPPORTED');
    expect(d?.params).toMatchObject({ query: 'Tmax', probe: 'stringTension', condition: 'max' });
    // Query hits do not split phases.
    expect(traj.phases).toHaveLength(2);
    expect(phaseAt(traj, tops[0].t)).toBe(1);
  });

  it('a query with an unknown reference is a compile error', () => {
    const { model, diagnostics } = compileModel({
      ...t01.spec,
      queries: [
        {
          id: 'q',
          probe: { kind: 'contactNormal', contact: 'c:nope:x:0' },
          condition: { kind: 'max' },
        },
      ],
    });
    expect(model).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['UNKNOWN_REFERENCE']);
  });
});
