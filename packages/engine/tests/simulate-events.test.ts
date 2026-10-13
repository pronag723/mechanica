/**
 * Regime changes located as events (prompt 03): leaving a surface, static friction breaking loose,
 * lift-off. The scenes are built here; the checks are physical identities at the event (the
 * friction limit, T = m·g at lift-off) and, where available, the oracle's values.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/sim/simulate';
import { probeValue } from '../src/sim/trajectory';
import type { BodySpec, ModelSpec } from '../src/spec';
import { compileOrThrow, expectedValue, relErr } from './helpers/scenes';

const g = { x: 0, y: -9.8 };
const frictionless = { muS: 0, muK: 0, restitution: 0 };

/** A small block B hanging ℓ = 0.625 m below a pulley's right tangent point, swung out by θ. */
function swingingB(xTangent: number, theta: number): BodySpec {
  const ell = 0.625;
  return {
    id: 'B',
    mass: 1,
    shape: { kind: 'box', w: 0.125, h: 0.125 },
    position: { x: xTangent + ell * Math.sin(theta), y: -ell * Math.cos(theta) },
  };
}

describe('leftSurface', () => {
  // A block slides off a frictionless table top 0.8 m above the floor (rotation locked: it is
  // supported until its trailing edge passes the table's edge).
  const spec: ModelSpec = {
    gravity: g,
    bodies: [
      {
        id: 'A',
        mass: 1,
        shape: { kind: 'box', w: 0.25, h: 0.25 },
        position: { x: -0.5, y: 0.125 },
        velocity: { x: 2, y: 0 },
      },
    ],
    statics: [
      {
        id: 'table',
        kind: 'convexPolygon',
        vertices: [
          { x: -3, y: -0.8 },
          { x: 0, y: -0.8 },
          { x: 0, y: 0 },
          { x: -3, y: 0 },
        ],
        material: frictionless,
      },
      {
        id: 'floor',
        kind: 'halfPlane',
        point: { x: 0, y: -0.8 },
        normal: { x: 0, y: 1 },
        material: frictionless,
      },
    ],
    pulleys: [],
    strings: [],
    options: { horizon: 2 },
  };

  it('fires when the trailing edge passes the edge; free fall, then touchdown on the floor', () => {
    const traj = simulate(compileOrThrow(spec));
    expect(traj.events.map((e) => [e.kind, e.ids[0]])).toEqual([
      ['leftSurface', 'c:A:table:2'],
      ['touchdown', 'c:A:floor:0'],
    ]);
    const [left, down] = traj.events;
    expect(relErr(left.t, 0.625 / 2)).toBeLessThan(1e-12);
    // The table top's gap goes negative beside the table without a spurious touchdown.
    expect(relErr(down.t - left.t, expectedValue('x04_slides_off_table', 't_fall'))).toBeLessThan(
      1e-9,
    );
    const vy = expectedValue('x04_slides_off_table', 'vy_landing');
    expect(relErr(down.data.rate as number, vy)).toBeLessThan(1e-9);
    expect(traj.phases[1].mode.active).toEqual([]);
    expect(traj.endReason).toBe('impactNotImplemented');
  });
});

describe('breakLoose', () => {
  // Block A (4 kg, μs = 0.3, μk = 0.2) on a table, string over the edge pulley to B swinging from
  // 0.6 rad: the tension grows towards the bottom of the swing until it exceeds μs·N = 11.76 N.
  const TOP = 'c:A:table:2';
  const spec: ModelSpec = {
    gravity: g,
    bodies: [
      { id: 'A', mass: 4, shape: { kind: 'box', w: 0.5, h: 0.25 }, position: { x: -2, y: 0.125 } },
      swingingB(0.25, 0.6),
    ],
    statics: [
      {
        id: 'table',
        kind: 'convexPolygon',
        vertices: [
          { x: -3, y: -1 },
          { x: 0, y: -1 },
          { x: 0, y: 0 },
          { x: -3, y: 0 },
        ],
        material: { muS: 0.3, muK: 0.2, restitution: 0 },
      },
    ],
    pulleys: [{ id: 'p', center: { x: 0.125, y: 0 }, radius: 0.125 }],
    strings: [
      {
        id: 's',
        route: [
          { kind: 'body', body: 'A', anchor: { x: 0.25, y: 0 } },
          { kind: 'pulley', pulley: 'p', wrap: 'cw' },
          { kind: 'body', body: 'B', anchor: { x: 0, y: 0 } },
        ],
      },
    ],
    options: { horizon: 0.5 },
  };

  it('fires once, exactly at |F_fr| = μs·N, and A then slides with kinetic friction', () => {
    const model = compileOrThrow(spec);
    const traj = simulate(model);
    expect(traj.events.map((e) => e.kind)).toEqual(['breakLoose']);
    const t = traj.events[0].t;
    expect(traj.phases.map((p) => p.mode.friction[TOP])).toEqual(['stick', 'slipPos']);
    const friction = { kind: 'contactFriction', contact: TOP } as const;
    const N = probeValue(model, traj, { kind: 'contactNormal', contact: TOP }, t);
    expect(relErr(N, 39.2)).toBeLessThan(1e-12);
    expect(relErr(-probeValue(model, traj, friction, t, 'before'), 0.3 * N)).toBeLessThan(1e-9);
    expect(relErr(-probeValue(model, traj, friction, t, 'after'), 0.2 * N)).toBeLessThan(1e-12);
    expect(traj.endReason).toBe('horizon');
  });
});

describe('separation', () => {
  // Block A (1.2 kg) rests on the floor under a pulley; B (1 kg) on the other side swings from
  // 0.6 rad. A lifts off when the tension reaches m_A·g = 11.76 N.
  const spec: ModelSpec = {
    gravity: g,
    bodies: [
      {
        id: 'A',
        mass: 1.2,
        shape: { kind: 'box', w: 0.25, h: 0.25 },
        position: { x: -0.25, y: -1.875 },
      },
      swingingB(0.25, 0.6),
    ],
    statics: [
      {
        id: 'floor',
        kind: 'halfPlane',
        point: { x: 0, y: -2 },
        normal: { x: 0, y: 1 },
        material: { muS: 0.5, muK: 0.5, restitution: 0 },
      },
    ],
    pulleys: [{ id: 'p', center: { x: 0, y: 0 }, radius: 0.25 }],
    strings: [
      {
        id: 's',
        route: [
          { kind: 'body', body: 'A', anchor: { x: 0, y: 0.125 } },
          { kind: 'pulley', pulley: 'p', wrap: 'cw' },
          { kind: 'body', body: 'B', anchor: { x: 0, y: 0 } },
        ],
      },
    ],
    options: { horizon: 0.5 },
  };

  it('one separation record (not also the friction cone), at T = m_A·g', () => {
    const model = compileOrThrow(spec);
    const traj = simulate(model);
    expect(traj.events.map((e) => [e.kind, e.ids[0]])).toEqual([['separation', 'c:A:floor:0']]);
    const t = traj.events[0].t;
    const T = probeValue(model, traj, { kind: 'stringTension', string: 's' }, t);
    expect(relErr(T, 1.2 * 9.8)).toBeLessThan(1e-9);
    expect(traj.phases.map((p) => p.mode.active)).toEqual([['c:A:floor:0', 's'], ['s']]);
    expect(probeValue(model, traj, { kind: 'contactNormal', contact: 'c:A:floor:0' }, t)).toBe(0);
    expect(
      probeValue(model, traj, { kind: 'bodyAcceleration', body: 'A', component: 'y' }, 0.45),
    ).toBeGreaterThan(0);
  });
});
