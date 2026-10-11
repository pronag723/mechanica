import { describe, expect, it } from 'vitest';
import { compileModel } from './model/compile';
import type { Model } from './model/types';
import { type Mode, modeKey, normalizeMode } from './mode';
import { type AccelerationSolution, solveAccelerations } from './solve';
import type { BodySpec, ModelSpec, StaticSpec, StringSpec } from './spec';

const G = 9.8;
const mat = (muS: number, muK: number): StaticSpec['material'] => ({ muS, muK, restitution: 0 });
const floor = (id = 'floor', muS = 0.5, muK = 0.25): StaticSpec => ({
  id,
  kind: 'halfPlane',
  point: { x: 0, y: 0 },
  normal: { x: 0, y: 1 },
  material: mat(muS, muK),
});
const block = (over: Partial<BodySpec> = {}): BodySpec => ({
  id: 'b',
  mass: 2,
  shape: { kind: 'box', w: 0.5, h: 0.25 },
  position: { x: 0, y: 0.125 },
  ...over,
});
const tie = (id: string, x: number, y: number, body = 'b'): StringSpec => ({
  id,
  route: [
    { kind: 'fixed', point: { x, y } },
    { kind: 'body', body, anchor: { x: 0, y: 0 } },
  ],
});

function compile(over: Partial<ModelSpec>): Model {
  const spec: ModelSpec = {
    gravity: { x: 0, y: -G },
    bodies: [block()],
    statics: [floor()],
    pulleys: [],
    strings: [],
    options: { horizon: 1 },
    ...over,
  };
  const { model, diagnostics } = compileModel(spec);
  if (!model) throw new Error(JSON.stringify(diagnostics));
  return model;
}

const C = 'c:b:floor:0';
const solve = (model: Model, mode: Mode, v?: ArrayLike<number>): AccelerationSolution =>
  solveAccelerations(model, mode, 0, model.q0, v ?? model.v0);

/** Newton's second law per body from the force breakdown: Σ F = m·a. */
function expectNewton(model: Model, sol: AccelerationSolution, tol = 1e-12): void {
  for (const b of model.bodies) {
    let fx = 0;
    let fy = 0;
    for (const f of sol.forces) {
      if (f.body !== b.id) continue;
      fx += f.vector.x;
      fy += f.vector.y;
    }
    expect(Math.abs(fx - b.mass * sol.a[b.dofX])).toBeLessThan(tol * Math.max(1, Math.abs(fx)));
    expect(Math.abs(fy - b.mass * sol.a[b.dofY])).toBeLessThan(tol * Math.max(1, Math.abs(fy)));
  }
}

describe('solveAccelerations: friction conventions', () => {
  it('slipPos: sliding along +t, kinetic friction μk·N along −t', () => {
    const model = compile({ appliedForces: [{ id: 'F', body: 'b', force: { x: 10, y: 0 } }] });
    const sol = solve(model, { active: [C], friction: { [C]: 'slipPos' } });
    expect(sol.status).toBe('unique');
    expect(sol.lambda[C]).toBeCloseTo(19.6, 13);
    expect(sol.frictionLambda[C]).toBeCloseTo(-0.25 * 19.6, 13);
    expect(sol.a[0]).toBeCloseTo((10 - 0.25 * 19.6) / 2, 13);
    expect(sol.a[1]).toBe(0);
    const friction = sol.forces.find((f) => f.kind === 'friction');
    expect(friction).toMatchObject({
      body: 'b',
      sourceId: C,
      symbol: 'F_fr',
      point: { x: 0, y: 0 },
    });
    expect(friction?.vector.x).toBeCloseTo(-4.9, 13);
    expectNewton(model, sol);
  });

  it('slipNeg: the mirror image, friction along +t', () => {
    const model = compile({ appliedForces: [{ id: 'F', body: 'b', force: { x: -10, y: 0 } }] });
    const sol = solve(model, { active: [C], friction: { [C]: 'slipNeg' } });
    expect(sol.frictionLambda[C]).toBeCloseTo(0.25 * 19.6, 13);
    expect(sol.a[0]).toBeCloseTo(-(10 - 0.25 * 19.6) / 2, 13);
    expectNewton(model, sol);
  });

  it('on an incline: t points up the slope; sliding down is slipNeg with friction up the slope', () => {
    const alpha = Math.PI / 6;
    const n = { x: -Math.sin(alpha), y: Math.cos(alpha) };
    const model = compile({
      bodies: [block({ angle: alpha, position: { x: 0.125 * n.x, y: 0.125 * n.y } })],
      statics: [
        {
          id: 'slope',
          kind: 'halfPlane',
          point: { x: 0, y: 0 },
          normal: n,
          material: mat(0.3, 0.2),
        },
      ],
    });
    const id = 'c:b:slope:0';
    const sol = solve(model, { active: [id], friction: { [id]: 'slipNeg' } });
    const t = { x: Math.cos(alpha), y: Math.sin(alpha) };
    const at = sol.a[0] * t.x + sol.a[1] * t.y;
    const an = sol.a[0] * n.x + sol.a[1] * n.y;
    expect(at).toBeCloseTo(G * (-Math.sin(alpha) + 0.2 * Math.cos(alpha)), 13);
    expect(Math.abs(an)).toBeLessThan(1e-14);
    expect(sol.lambda[id]).toBeCloseTo(2 * G * Math.cos(alpha), 13);
    expect(sol.frictionLambda[id]).toBeCloseTo(0.2 * 2 * G * Math.cos(alpha), 13);
    expectNewton(model, sol);
  });

  it('stick: a static-friction row, λ_t signed along +t and within μs·N', () => {
    const model = compile({ appliedForces: [{ id: 'F', body: 'b', force: { x: 5, y: 0 } }] });
    const sol = solve(model, { active: [C], friction: { [C]: 'stick' } });
    expect([...sol.a]).toEqual([0, 0]);
    expect(sol.frictionLambda[C]).toBe(-5);
    expect(sol.lambda[C]).toBeCloseTo(19.6, 14);
    expect(Math.abs(sol.frictionLambda[C])).toBeLessThanOrEqual(0.5 * sol.lambda[C]);
    expectNewton(model, sol);
  });

  it('statics sanity: a block resting on the ground has N = mg and a = 0', () => {
    const model = compile({});
    const sol = solve(model, { active: [C], friction: { [C]: 'stick' } });
    expect(sol.lambda[C]).toBeCloseTo(19.6, 14);
    expect(sol.frictionLambda[C]).toBe(0);
    expect([...sol.a]).toEqual([0, 0]);
    expect(sol.forces.map((f) => f.kind)).toEqual(['gravity', 'normal', 'friction']);
    expectNewton(model, sol);
  });

  it('a frictionless sliding contact contributes no friction force', () => {
    const model = compile({ statics: [floor('floor', 0, 0)] });
    const sol = solve(model, { active: [C], friction: { [C]: 'slipPos' } });
    expect(Object.is(sol.frictionLambda[C], 0)).toBe(true);
    expect(sol.forces.map((f) => f.kind)).toEqual(['gravity', 'normal']);
  });
});

describe('solveAccelerations: strings', () => {
  it('pendulum at the bottom: the curvature term gives T = mg + mv²/ℓ and a centripetal a', () => {
    const model = compile({
      bodies: [block({ position: { x: 0, y: 0 } })],
      statics: [],
      strings: [tie('s', 0, 1)],
    });
    const sol = solve(model, { active: ['s'], friction: {} }, [3, 0]);
    expect(sol.lambda.s).toBeCloseTo(2 * G + 2 * 9, 12);
    expect(sol.a[0]).toBe(0);
    expect(sol.a[1]).toBeCloseTo(9, 12);
    const tension = sol.forces.find((f) => f.kind === 'tension');
    expect(tension).toMatchObject({ sourceId: 's', symbol: 'T', point: { x: 0, y: 0 } });
    expect(tension?.vector.y).toBeCloseTo(37.6, 12); // pulls towards the pivot
    expectNewton(model, sol);
  });

  it('a massless knot held by two strings is determined (zero mass entries are fine)', () => {
    const model = compile({
      bodies: [block({ id: 'k', mass: 0, position: { x: 0, y: 0 } })],
      statics: [],
      strings: [tie('left', -1, 1, 'k'), tie('right', 1, 1, 'k')],
      appliedForces: [{ id: 'F', body: 'k', force: { x: 0, y: -10 } }],
    });
    const sol = solve(model, { active: ['left', 'right'], friction: {} });
    expect(sol.status).toBe('unique');
    expect(sol.lambda.left).toBeCloseTo(10 / Math.SQRT2, 13);
    expect(sol.lambda.right).toBeCloseTo(10 / Math.SQRT2, 13);
    expect(Math.hypot(sol.a[0], sol.a[1])).toBeLessThan(1e-14);
  });
});

describe("solveAccelerations: report, don't guess", () => {
  it('MOTION_UNDETERMINED: a massless body on one string', () => {
    const model = compile({
      bodies: [block({ id: 'k', mass: 0, position: { x: 0, y: 0 } })],
      statics: [],
      strings: [tie('s', 0, 1, 'k')],
    });
    const sol = solve(model, { active: ['s'], friction: {} });
    expect(sol.status).toBe('undetermined');
    expect(sol.diagnostics).toMatchObject([
      {
        code: 'MOTION_UNDETERMINED',
        severity: 'error',
        params: { reason: 'singular', bodies: ['k'] },
      },
    ]);
    expect([...sol.a].every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(sol.lambda.s)).toBe(true);
    expect(sol.forces).toEqual([]);
  });

  it('MOTION_UNDETERMINED: contradictory active constraints (inconsistent)', () => {
    // Two vertical strings of lengths 1 and 2 to one point moving sideways: the centripetal
    // conditions a_y = v²/1 and a_y = v²/2 cannot both hold.
    const model = compile({
      bodies: [block({ position: { x: 0, y: 0 } })],
      statics: [],
      strings: [tie('short', 0, 1), tie('long', 0, 2)],
    });
    const sol = solve(model, { active: ['long', 'short'], friction: {} }, [1, 0]);
    expect(sol.diagnostics).toMatchObject([
      { code: 'MOTION_UNDETERMINED', params: { reason: 'inconsistent' } },
    ]);
  });

  it('two coincident supports with equal μ: forces indeterminate, motion unique', () => {
    const model = compile({ statics: [floor('f1', 0.2, 0.2), floor('f2', 0.2, 0.2)] });
    const ids = ['c:b:f1:0', 'c:b:f2:0'];
    const sol = solve(
      model,
      { active: ids, friction: { [ids[0]]: 'slipPos', [ids[1]]: 'slipPos' } },
      [1, 0],
    );
    expect(sol.status).toBe('indeterminate');
    expect(sol.indeterminate).toEqual(ids);
    expect(sol.indeterminateFriction).toEqual(ids);
    expect(sol.a[0]).toBeCloseTo(-0.2 * G, 13);
    expect(Math.abs(sol.a[1])).toBeLessThan(1e-14);
    // The returned split is the minimum-norm one, flagged as such.
    expect(sol.lambda[ids[0]]).toBeCloseTo(9.8, 12);
    expect(sol.forces.filter((f) => f.kind === 'normal').every((f) => f.indeterminate)).toBe(true);
    expect(sol.diagnostics).toMatchObject([
      { code: 'STATICALLY_INDETERMINATE', severity: 'warning', elementIds: ['b', 'f1', 'f2'] },
    ]);
    expectNewton(model, sol);
  });

  it('two coincident supports with different μ: the friction split decides the motion', () => {
    const model = compile({ statics: [floor('f1', 0.1, 0.1), floor('f2', 0.3, 0.3)] });
    const ids = ['c:b:f1:0', 'c:b:f2:0'];
    const sol = solve(
      model,
      { active: ids, friction: { [ids[0]]: 'slipPos', [ids[1]]: 'slipPos' } },
      [1, 0],
    );
    expect(sol.status).toBe('undetermined');
    expect(sol.diagnostics[0]).toMatchObject({
      code: 'MOTION_UNDETERMINED',
      params: { bodies: ['b'] },
    });
  });
});

describe('solveAccelerations: edge cases', () => {
  it('a scene without bodies solves to nothing', () => {
    const model = compile({ bodies: [] });
    const sol = solve(model, { active: [], friction: {} });
    expect(sol.status).toBe('unique');
    expect(sol.a).toHaveLength(0);
    expect(sol.forces).toEqual([]);
  });

  it('a free body falls with g; an inactive contact exerts nothing', () => {
    const model = compile({});
    const sol = solve(model, { active: [], friction: {} });
    expect([...sol.a]).toEqual([0, -G]);
    expect(sol.forces.map((f) => f.kind)).toEqual(['gravity']);
  });
});

describe('modes', () => {
  const model = compile({ strings: [tie('s', 0, 2)] });

  it('rejects malformed modes with RangeError (engine misuse, not a scene problem)', () => {
    const bad: Mode[] = [
      { active: ['nope'], friction: {} },
      { active: [C], friction: {} },
      { active: [C, C], friction: { [C]: 'stick' } },
      { active: ['s'], friction: { s: 'stick' } },
      { active: [], friction: { [C]: 'stick' } },
    ];
    for (const mode of bad) expect(() => solve(model, mode)).toThrow(RangeError);
  });

  it('normalizes and keys modes canonically', () => {
    const a: Mode = { active: [C, 's'], friction: { [C]: 'stick' } };
    const b: Mode = { active: ['s', C], friction: { [C]: 'stick' } };
    expect(normalizeMode(b)).toEqual(normalizeMode(a));
    expect(modeKey(a)).toBe(modeKey(b));
    expect(modeKey(a)).toBe(`${C},s|${C}=stick`);
  });

  it('is deterministic: identical calls give bit-identical results', () => {
    const mode: Mode = { active: [C, 's'], friction: { [C]: 'slipPos' } };
    const v = [0.7, 0];
    const r1 = solve(model, mode, v);
    const r2 = solve(model, mode, v);
    expect(new Uint8Array(r2.a.buffer)).toEqual(new Uint8Array(r1.a.buffer));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
    expect(Object.entries(r2.lambda).every(([k, x]) => Object.is(x, r1.lambda[k]))).toBe(true);
  });
});
