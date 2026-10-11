/**
 * Instantaneous solves of the Phase 0 scenes in an explicitly given mode, against the oracle's
 * expected.json at relative 1e-12 (prompt 02). Mode selection and integration come in prompt 03.
 */
import { describe, expect, it } from 'vitest';
import t01Json from '../../../tests/scenes/engine/t01_atwood.json';
import t02Json from '../../../tests/scenes/engine/t02_table.json';
import t03Json from '../../../tests/scenes/engine/t03_load_hits_floor.json';
import t14Json from '../../../tests/scenes/engine/t14_two_strings.json';
import { contactGap } from '../src/constraints/contact';
import { stringGeometry } from '../src/constraints/string';
import { compileModel } from '../src/model/compile';
import type { ContactConstraint, Model } from '../src/model/types';
import type { Mode } from '../src/mode';
import { type AccelerationSolution, solveAccelerations } from '../src/solve';
import { compileOrThrow, expectedValue, loadScene, relErr, variantSpec } from './helpers/scenes';

const REL = 1e-12;
const t01 = loadScene(t01Json);
const t02 = loadScene(t02Json);
const t03 = loadScene(t03Json);
const t14 = loadScene(t14Json);

const solve = (model: Model, mode: Mode): AccelerationSolution =>
  solveAccelerations(model, mode, 0, model.q0, model.v0);
const dof = (model: Model, body: string, axis: 'x' | 'y'): number => {
  const b = model.bodies[model.bodyIndex.get(body) ?? -1];
  return axis === 'x' ? b.dofX : b.dofY;
};
const contact = (model: Model, id: string): ContactConstraint => {
  const c = model.constraints[model.constraintIndex.get(id) ?? -1];
  if (c?.kind !== 'contact') throw new Error(`no contact ${id}`);
  return c;
};
function expectClose(actual: number, scene: string, key: string): void {
  const e = expectedValue(scene, key);
  expect(relErr(actual, e), `${scene}.${key}: ${actual} vs ${e}`).toBeLessThanOrEqual(REL);
}

/** Every string segment is exactly horizontal or vertical. */
function expectAxisAligned(model: Model, stringId: string): void {
  const geo = stringGeometry(model, stringId, model.q0);
  if (!geo.ok) throw new Error('no string path');
  for (const s of geo.segments) {
    expect(s.direction.x === 0 || s.direction.y === 0, JSON.stringify(s)).toBe(true);
  }
}

describe('t01 Atwood machine', () => {
  const model = compileOrThrow(t01.spec);

  it('has textbook geometry: both segments exactly vertical, half a turn on the pulley', () => {
    const geo = stringGeometry(model, 'string', model.q0);
    if (!geo.ok) throw new Error('no path');
    expect(geo.segments.map((s) => s.direction)).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]);
    expect(geo.arcs[0].angle).toBe(Math.PI);
  });

  it('a and T', () => {
    const sol = solve(model, { active: ['string'], friction: {} });
    expect(sol.status).toBe('unique');
    expectClose(-sol.a[dof(model, 'm1', 'y')], 't01_atwood', 'a');
    expectClose(sol.a[dof(model, 'm2', 'y')], 't01_atwood', 'a');
    expect(sol.a[dof(model, 'm1', 'x')]).toBe(0);
    expect(sol.a[dof(model, 'm2', 'x')]).toBe(0);
    expectClose(sol.lambda.string, 't01_atwood', 'T');
  });
});

describe('t02 block on a table, hanging mass', () => {
  const TOP = 'c:A:table:2';
  const slip: Mode = { active: [TOP, 'string'], friction: { [TOP]: 'slipPos' } };
  const stick: Mode = { active: [TOP, 'string'], friction: { [TOP]: 'stick' } };

  it('has textbook geometry: A exactly on the table, string horizontal then vertical', () => {
    const model = compileOrThrow(variantSpec(t02, 't02a_table_frictionless'));
    expect(contactGap(contact(model, TOP), model.q0)).toBe(0);
    expectAxisAligned(model, 'string');
  });

  for (const id of ['t02a_table_frictionless', 't02b_table_kinetic'] as const) {
    it(`${id} (slip mode): a, T, N${id === 't02b_table_kinetic' ? ', F_fr' : ''}`, () => {
      const model = compileOrThrow(variantSpec(t02, id));
      const sol = solve(model, slip);
      expect(sol.status).toBe('unique');
      expectClose(sol.a[dof(model, 'A', 'x')], id, 'a');
      expectClose(-sol.a[dof(model, 'B', 'y')], id, 'a');
      expect(sol.a[dof(model, 'A', 'y')]).toBe(0);
      expectClose(sol.lambda.string, id, 'T');
      expectClose(sol.lambda[TOP], id, 'N');
      if (id === 't02b_table_kinetic') {
        // Kinetic friction points away from the pulley (−t): negative along t = +x.
        expect(sol.frictionLambda[TOP]).toBeLessThan(0);
        expectClose(-sol.frictionLambda[TOP], id, 'F_fr');
      }
    });
  }

  it('t02c_table_static (stick mode): F_fr = mg = 9.8, not μs·N; T = 9.8', () => {
    const id = 't02c_table_static';
    const model = compileOrThrow(variantSpec(t02, id));
    const sol = solve(model, stick);
    expect(sol.status).toBe('unique');
    for (const a of sol.a) expect(Math.abs(a)).toBeLessThanOrEqual(1e-12);
    expectClose(-sol.frictionLambda[TOP], id, 'F_fr');
    expectClose(sol.lambda.string, id, 'T');
    expectClose(sol.lambda[TOP], id, 'N');
    const { muS } = contact(model, TOP).material;
    expectClose(muS * sol.lambda[TOP], id, 'F_fr_limit');
    expect(Math.abs(sol.frictionLambda[TOP])).toBeLessThanOrEqual(muS * sol.lambda[TOP]);
  });
});

describe('t03 load hits the floor (phase 1 only)', () => {
  const model = compileOrThrow(t03.spec);
  const TOP = 'c:A:table:2';

  it('has textbook geometry: A on the table, B exactly h = 0.5 m above the floor', () => {
    expect(contactGap(contact(model, TOP), model.q0)).toBe(0);
    expect(contactGap(contact(model, 'c:B:floor:0'), model.q0)).toBe(0.5);
    expectAxisAligned(model, 'string');
  });

  it('before the impact: a and T1', () => {
    const sol = solve(model, { active: [TOP, 'string'], friction: { [TOP]: 'slipPos' } });
    expectClose(sol.a[dof(model, 'A', 'x')], 't03_load_hits_floor', 'a');
    expectClose(-sol.a[dof(model, 'B', 'y')], 't03_load_hits_floor', 'a');
    expectClose(sol.lambda.string, 't03_load_hits_floor', 'T1');
  });
});

describe('t14 statics: two strings', () => {
  const model = compileOrThrow(t14.spec);

  it('has the textbook angles: 30° and 60° to the horizontal', () => {
    for (const [id, angle] of [
      ['s30', Math.PI / 6],
      ['s60', Math.PI / 3],
    ] as const) {
      const geo = stringGeometry(model, id, model.q0);
      if (!geo.ok) throw new Error('no path');
      const d = geo.segments[0].direction;
      expect(Math.abs(Math.atan2(Math.abs(d.y), Math.abs(d.x)) - angle)).toBeLessThan(1e-15);
    }
  });

  it('T30 and T60, at rest', () => {
    const sol = solve(model, { active: ['s30', 's60'], friction: {} });
    expect(sol.status).toBe('unique');
    expectClose(sol.lambda.s30, 't14_two_strings', 'T30');
    expectClose(sol.lambda.s60, 't14_two_strings', 'T60');
    for (const a of sol.a) expect(Math.abs(a)).toBeLessThanOrEqual(1e-12);
  });

  it('a third taut string makes the tensions statically indeterminate (the motion is still a = 0)', () => {
    const three = compileOrThrow(variantSpec(t14, 'three_strings'));
    const sol = solve(three, { active: ['s30', 's60', 's90'], friction: {} });
    expect(sol.status).toBe('indeterminate');
    expect(sol.indeterminate).toEqual(['s30', 's60', 's90']);
    expect(sol.diagnostics).toHaveLength(1);
    expect(sol.diagnostics[0]).toMatchObject({
      code: 'STATICALLY_INDETERMINATE',
      severity: 'warning',
      elementIds: ['s30', 's60', 's90'],
      params: { constraints: ['s30', 's60', 's90'] },
    });
    for (const a of sol.a) expect(Math.abs(a)).toBeLessThanOrEqual(1e-12);
    expect(sol.forces.filter((f) => f.kind === 'tension').every((f) => f.indeterminate)).toBe(true);
  });
});

describe('determinism', () => {
  it('compiling and solving twice gives bit-identical outputs', () => {
    const run = (): AccelerationSolution => {
      const { model } = compileModel(variantSpec(t02, 't02b_table_kinetic'));
      if (!model) throw new Error('no model');
      const TOP = 'c:A:table:2';
      return solve(model, { active: [TOP, 'string'], friction: { [TOP]: 'slipPos' } });
    };
    const r1 = run();
    const r2 = run();
    expect(new Uint8Array(r2.a.buffer)).toEqual(new Uint8Array(r1.a.buffer));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
  });
});

describe('performance', () => {
  it('logs the cost of compileModel and solveAccelerations', () => {
    const spec = variantSpec(t02, 't02b_table_kinetic');
    const TOP = 'c:A:table:2';
    const mode: Mode = { active: [TOP, 'string'], friction: { [TOP]: 'slipPos' } };
    const model = compileOrThrow(spec);
    for (let i = 0; i < 2000; i++) solve(model, mode); // warm-up
    const N = 20000;
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    let t0 = performance.now();
    for (let i = 0; i < N; i++) solve(model, mode);
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    const solveUs = ((performance.now() - t0) / N) * 1000;
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    t0 = performance.now();
    for (let i = 0; i < N / 10; i++) compileModel(spec);
    // eslint-disable-next-line no-restricted-globals -- benchmark timing
    const compileUs = ((performance.now() - t0) / (N / 10)) * 1000;
    console.log(
      `t02b: solveAccelerations ${solveUs.toFixed(2)} µs/call, compileModel ${compileUs.toFixed(2)} µs/call`,
    );
    expect(solveUs).toBeGreaterThan(0);
  });
});
