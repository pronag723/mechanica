import { describe, expect, it } from 'vitest';
import type { DiagnosticCode } from '../diagnostics';
import type { BodySpec, ModelSpec, StaticSpec, StringSpec } from '../spec';
import { compileModel } from './compile';
import type { ContactConstraint, StringConstraint } from './types';

const material = { muS: 0.3, muK: 0.2, restitution: 0.5 };
const floor: StaticSpec = {
  id: 'floor',
  kind: 'halfPlane',
  point: { x: 0, y: 0 },
  normal: { x: 0, y: 2 },
  material,
};
const box = (id: string, x: number, y: number, mass = 1): BodySpec => ({
  id,
  mass,
  shape: { kind: 'box', w: 0.5, h: 0.25 },
  position: { x, y },
});
const base = (over: Partial<ModelSpec> = {}): ModelSpec => ({
  gravity: { x: 0, y: -9.8 },
  bodies: [box('b', 0, 0.125)],
  statics: [floor],
  pulleys: [],
  strings: [],
  options: { horizon: 1 },
  ...over,
});
const hang = (id: string, body: string, x: number, restLength?: number): StringSpec => ({
  id,
  route: [
    { kind: 'fixed', point: { x, y: 2 } },
    { kind: 'body', body, anchor: { x: 0, y: 0.125 } },
  ],
  ...(restLength === undefined ? {} : { restLength }),
});

function codes(spec: ModelSpec): DiagnosticCode[] {
  return compileModel(spec).diagnostics.map((d) => d.code);
}

describe('compileModel: layout', () => {
  it('lays out x, y per body in id order, with masses and the initial state', () => {
    const { model, diagnostics } = compileModel(
      base({
        bodies: [
          { ...box('zeta', 1, 0.125, 2), velocity: { x: 3, y: 0 } },
          box('alpha', -1, 0.125, 5),
        ],
      }),
    );
    expect(diagnostics).toEqual([]);
    if (!model) throw new Error('no model');
    expect(model.dofs).toEqual([
      { kind: 'x', body: 'alpha' },
      { kind: 'y', body: 'alpha' },
      { kind: 'x', body: 'zeta' },
      { kind: 'y', body: 'zeta' },
    ]);
    expect([...model.mass]).toEqual([5, 5, 2, 2]);
    expect([...model.q0]).toEqual([-1, 0.125, 1, 0.125]);
    expect([...model.v0]).toEqual([0, 0, 3, 0]);
    expect(model.bodyIndex.get('zeta')).toBe(1);
  });

  it('creates one contact candidate per body × face, sorted by id, with provenance', () => {
    const table: StaticSpec = {
      id: 'table',
      kind: 'convexPolygon',
      vertices: [
        { x: 2, y: -1 },
        { x: 4, y: -1 },
        { x: 4, y: 0 },
        { x: 2, y: 0 },
      ],
      material,
    };
    const { model } = compileModel(
      base({ bodies: [box('b', 0, 0.125), box('a', 3, 0.125)], statics: [table, floor] }),
    );
    if (!model) throw new Error('no model');
    expect(model.constraints.map((c) => c.id)).toEqual([
      'c:a:floor:0',
      'c:a:table:0',
      'c:a:table:1',
      'c:a:table:2',
      'c:a:table:3',
      'c:b:floor:0',
      'c:b:table:0',
      'c:b:table:1',
      'c:b:table:2',
      'c:b:table:3',
    ]);
    model.constraints.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(model.constraintIndex.get(c.id)).toBe(i);
    });
    const top = model.constraints[3] as ContactConstraint;
    expect(top).toMatchObject({
      kind: 'contact',
      sided: 'unilateral',
      linear: true,
      body: 'a',
      staticId: 'table',
      face: 2,
      normal: { x: 0, y: 1 },
      tangent: { x: 1, y: 0 },
      offset: 0,
      depth: -0.125,
      faceLo: 2,
      faceHi: 4,
      provenance: { elementId: 'a', kind: 'contact', symbol: 'N' },
      elementIds: ['a', 'table'],
    });
    // Outward normals of a CCW polygon: bottom, right, top, left.
    const normals = model.constraints.slice(1, 5).map((c) => (c as ContactConstraint).normal);
    expect(normals).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]);
    // A half-plane's normal is normalized; its face is infinite.
    const fl = model.constraints[0] as ContactConstraint;
    expect(fl.normal).toEqual({ x: 0, y: 1 });
    expect([fl.faceLo, fl.faceHi]).toEqual([-Infinity, Infinity]);
  });

  it('takes the material from the support, then pair overrides in order (either id order)', () => {
    const { model } = compileModel(
      base({
        pairOverrides: [
          { a: 'floor', b: 'b', muS: 0.9 },
          { a: 'b', b: 'floor', muK: 0.1 },
        ],
      }),
    );
    expect((model?.constraints[0] as ContactConstraint).material).toEqual({
      muS: 0.9,
      muK: 0.1,
      restitution: 0.5,
    });
  });

  it('builds strings: rest length defaults to the initial length; an explicit longer one is slack', () => {
    const { model } = compileModel(
      base({
        strings: [hang('s1', 'b', 0), { ...hang('s2', 'b', 0), symbol: 'T₂', restLength: 2.5 }],
      }),
    );
    if (!model) throw new Error('no model');
    const s1 = model.constraints.find((c) => c.id === 's1') as StringConstraint;
    const s2 = model.constraints.find((c) => c.id === 's2') as StringConstraint;
    expect(s1.restLength).toBe(1.75);
    expect(s1.linear).toBe(false);
    expect(s1.provenance).toEqual({ elementId: 's1', kind: 'string', symbol: 'T' });
    expect(s2.restLength).toBe(2.5);
    expect(s2.provenance.symbol).toBe('T₂');
    expect(model.maxRouteNodes).toBe(2);
  });

  it('computes the scene scales', () => {
    const { model } = compileModel(
      base({ bodies: [box('b', 0, 0.125, 2)], statics: [{ ...floor, point: { x: 3, y: -4 } }] }),
    );
    // Bounding box of the box [−0.25, 0.25] × [0, 0.25] and the point (3, −4).
    expect(model?.scales.length).toBe(Math.hypot(3.25, 4.25));
    expect(model?.scales.force).toBeCloseTo(19.6, 14);
    expect(model?.scales.velocity).toBeCloseTo(Math.sqrt(9.8 * Math.hypot(3.25, 4.25)), 14);
  });

  it('is deterministic', () => {
    const spec = base({ strings: [hang('s', 'b', 0.5)] });
    expect(compileModel(spec)).toEqual(compileModel(spec));
  });
});

describe('compileModel: diagnostics', () => {
  it('accepts a block resting exactly on the floor, and a gap within the tolerance', () => {
    expect(codes(base())).toEqual([]);
    expect(codes(base({ bodies: [box('b', 0, 0.125 - 1e-12)] }))).toEqual([]);
  });

  it('BODY_PENETRATES_STATIC by the separating-axis test', () => {
    const r = compileModel(base({ bodies: [box('b', 0, 0.12)] }));
    expect(r.model).toBeNull();
    expect(r.diagnostics).toMatchObject([
      { code: 'BODY_PENETRATES_STATIC', severity: 'error', elementIds: ['b', 'floor'] },
    ]);
    expect(r.diagnostics[0].params.depth).toBeCloseTo(0.005, 15);
    // Beside a polygon support at the height of its top: the side face separates them.
    const table: StaticSpec = {
      id: 'table',
      kind: 'convexPolygon',
      vertices: [
        { x: -2, y: -1 },
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: -2, y: 0 },
      ],
      material,
    };
    expect(codes(base({ bodies: [box('b', 0.3, 0)], statics: [table] }))).toEqual([]);
    expect(codes(base({ bodies: [box('b', 0.2, 0)], statics: [table] }))).toEqual([
      'BODY_PENETRATES_STATIC',
    ]);
  });

  it('STRING_ROUTE_INVALID', () => {
    const fixed = { kind: 'fixed', point: { x: 0, y: 2 } } as const;
    const end = { kind: 'body', body: 'b', anchor: { x: 0, y: 0 } } as const;
    const via = { kind: 'pulley', pulley: 'p', wrap: 'cw' } as const;
    const pulleys = [{ id: 'p', center: { x: 1, y: 1 }, radius: 0.1 }];
    const reasons = (route: StringSpec['route']): unknown[] =>
      compileModel(base({ pulleys, strings: [{ id: 's', route }] })).diagnostics.map(
        (d) => d.params.reason,
      );
    expect(reasons([end])).toEqual(['tooShort']);
    expect(reasons([via, end])).toEqual(['endNotEnd']);
    expect(reasons([end, fixed, end])).toEqual(['viaNotPulley']);
    expect(reasons([fixed, via, fixed])).toEqual(['noBody']);
    expect(reasons([end, via, via, fixed])).toEqual(['repeatedPulley']);
  });

  it('STRING_SEGMENT_DEGENERATE', () => {
    const r = compileModel(
      base({
        strings: [
          {
            id: 's',
            route: [
              { kind: 'fixed', point: { x: 0, y: 0.25 } },
              { kind: 'body', body: 'b', anchor: { x: 0, y: 0.125 } },
            ],
          },
        ],
      }),
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(['STRING_SEGMENT_DEGENERATE']);
    expect(r.model).toBeNull();
  });

  it('PULLEY_WRAP_INVALID: no tangent, or a wrap of 0', () => {
    const pulleys = [{ id: 'p', center: { x: 0, y: 1 }, radius: 0.5 }];
    const route = (x: number, wrap: 'cw' | 'ccw'): StringSpec['route'] => [
      { kind: 'fixed', point: { x, y: 1.5 } },
      { kind: 'pulley', pulley: 'p', wrap },
      { kind: 'body', body: 'b', anchor: { x: 0.5, y: 0.125 } },
    ];
    const at = (x: number, wrap: 'cw' | 'ccw'): unknown[] =>
      compileModel(
        base({ pulleys, strings: [{ id: 's', route: route(x, wrap) }] }),
      ).diagnostics.map((d) => [d.code, d.params.reason]);
    // From (−1, 1.5) along the top of the pulley and down its right side: a quarter turn.
    expect(at(-1, 'cw')).toEqual([]);
    // The same fixed point inside the pulley: no tangent.
    expect(
      compileModel(
        base({
          pulleys,
          strings: [
            {
              id: 's',
              route: [{ kind: 'fixed', point: { x: 0.1, y: 1.2 } }, ...route(0, 'cw').slice(1)],
            },
          ],
        }),
      ).diagnostics.map((d) => [d.code, d.params.reason]),
    ).toEqual([['PULLEY_WRAP_INVALID', 'tangentMissing']]);
  });

  it('PULLEY_WRAP_INVALID: a string that passes a pulley straight (wrap 0)', () => {
    const r = compileModel(
      base({
        pulleys: [{ id: 'p', center: { x: 0, y: 1 }, radius: 0.25 }],
        strings: [
          {
            id: 's',
            route: [
              // Straight down the pulley's left side, which is on the string's left: ccw.
              { kind: 'fixed', point: { x: -0.25, y: 3 } },
              { kind: 'pulley', pulley: 'p', wrap: 'ccw' },
              { kind: 'body', body: 'b', anchor: { x: -0.25, y: 0.125 } },
            ],
          },
        ],
      }),
    );
    expect(r.diagnostics).toMatchObject([
      {
        code: 'PULLEY_WRAP_INVALID',
        params: { reason: 'wrapZero', node: 1 },
        elementIds: ['s', 'p'],
      },
    ]);
  });

  it('STRING_OVERSTRETCHED', () => {
    expect(codes(base({ strings: [hang('s', 'b', 0, 1.5)] }))).toEqual(['STRING_OVERSTRETCHED']);
    expect(codes(base({ strings: [hang('s', 'b', 0, 1.75)] }))).toEqual([]);
  });

  it('UNKNOWN_REFERENCE', () => {
    const r = compileModel(
      base({
        pulleys: [{ id: 'p', center: { x: 1, y: 1 }, radius: 0.1 }],
        strings: [
          {
            id: 's',
            route: [
              { kind: 'body', body: 'ghost', anchor: { x: 0, y: 0 } },
              { kind: 'pulley', pulley: 'b', wrap: 'cw' },
              { kind: 'fixed', point: { x: 0, y: 3 } },
            ],
          },
        ],
        appliedForces: [{ id: 'F', body: 'nobody', force: { x: 1, y: 0 } }],
        pairOverrides: [{ a: 'b', b: 'p', muS: 0 }],
      }),
    );
    expect(r.diagnostics.map((d) => [d.code, d.params.ref])).toEqual([
      ['UNKNOWN_REFERENCE', 'ghost'],
      ['UNKNOWN_REFERENCE', 'b'],
      ['UNKNOWN_REFERENCE', 'nobody'],
      ['UNKNOWN_REFERENCE', 'b|p'],
    ]);
  });

  it('INVALID_ID, INVALID_PARAMETER and SHAPE_INVALID', () => {
    const r = compileModel(
      base({
        bodies: [
          box('b', 0, 0.125),
          box('b', 1, 0.125, -1),
          box('x:y', 2, 0.125),
          {
            id: 'tri',
            mass: 1,
            shape: {
              kind: 'convexPolygon',
              vertices: [
                { x: 0, y: 0 },
                { x: 0, y: 1 },
                { x: 1, y: 0 },
              ],
            },
            position: { x: 5, y: 1 },
          },
        ],
        statics: [{ ...floor, material: { muS: -1, muK: 0, restitution: 2 } }],
      }),
    );
    expect(r.diagnostics.map((d) => [d.code, d.params.reason])).toEqual([
      ['INVALID_ID', 'duplicate'],
      ['INVALID_ID', 'reservedCharacter'],
      ['INVALID_PARAMETER', 'outOfRange'], // mass −1
      ['SHAPE_INVALID', 'notCounterClockwise'],
      ['INVALID_PARAMETER', 'outOfRange'], // muS
      ['INVALID_PARAMETER', 'outOfRange'], // restitution
    ]);
    expect(r.diagnostics[4]).toMatchObject({
      elementIds: ['floor'],
      params: { field: 'material.muS' },
    });
    const po = compileModel(base({ pairOverrides: [{ a: 'b', b: 'floor', muK: -0.1 }] }));
    expect(po.diagnostics).toMatchObject([
      {
        code: 'INVALID_PARAMETER',
        elementIds: ['b', 'floor'],
        params: { field: 'pairOverrides[0].muK' },
      },
    ]);
    expect(r.model).toBeNull();
  });
});
