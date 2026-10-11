import { describe, expect, it } from 'vitest';
import { directionalDerivative, secondDirectionalDerivative, unit } from '../../tests/helpers/fd';
import { type Rng, createRng } from '../../tests/helpers/prng';
import { compileModel } from '../model/compile';
import type { ContactConstraint, Model } from '../model/types';
import type { ModelSpec, ShapeSpec, StaticSpec, Vec2 } from '../spec';
import { createModelRow, evalConstraint } from '.';
import { contactGap, contactOverlap, contactPoint, contactTangentialVelocity } from './contact';

const ANGLES = [0, 0.3, Math.PI / 6, Math.PI / 2, 2.5, -1.1];
const material = { muS: 0.5, muK: 0.4, restitution: 0 };

/** Random strictly convex polygon: sorted angles on an ellipse, counter-clockwise. */
function convexPolygon(rng: Rng, n: number, cx: number, cy: number, a: number, b: number): Vec2[] {
  const angles = Array.from(
    { length: n },
    (_, k) => (2 * Math.PI * (k + rng.uniform(0.1, 0.9))) / n,
  );
  return angles.map((t) => ({ x: cx + a * Math.cos(t), y: cy + b * Math.sin(t) }));
}

function model(shape: ShapeSpec, angle: number, position: Vec2, statics: StaticSpec[]): Model {
  const spec: ModelSpec = {
    gravity: { x: 0, y: -9.8 },
    bodies: [{ id: 'b', mass: 1, shape, angle, position }],
    statics,
    pulleys: [],
    strings: [],
    options: { horizon: 1 },
  };
  const { model: m, diagnostics } = compileModel(spec);
  if (!m) throw new Error(JSON.stringify(diagnostics));
  return m;
}

/** World vertices of the body at q, computed independently of the compiler. */
function worldVertices(shape: ShapeSpec, angle: number, q: ArrayLike<number>): Vec2[] {
  const local =
    shape.kind === 'box'
      ? [
          { x: -shape.w / 2, y: -shape.h / 2 },
          { x: shape.w / 2, y: -shape.h / 2 },
          { x: shape.w / 2, y: shape.h / 2 },
          { x: -shape.w / 2, y: shape.h / 2 },
        ]
      : shape.vertices;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return local.map((v) => ({ x: q[0] + c * v.x - s * v.y, y: q[1] + s * v.x + c * v.y }));
}

/** Faces of a support, computed independently: unit outward normal and a point on the face. */
function faces(s: StaticSpec): { n: Vec2; a: Vec2; b?: Vec2 }[] {
  if (s.kind === 'halfPlane') {
    const len = Math.hypot(s.normal.x, s.normal.y);
    return [{ n: { x: s.normal.x / len, y: s.normal.y / len }, a: s.point }];
  }
  return s.vertices.map((a, i) => {
    const b = s.vertices[(i + 1) % s.vertices.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { n: { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }, a, b };
  });
}

describe('contact gap: value, gradient and curvature', () => {
  const rng = createRng(4242);
  const shapes: ShapeSpec[] = [
    { kind: 'box', w: 0.5, h: 0.25 },
    { kind: 'convexPolygon', vertices: convexPolygon(rng, 5, 0.02, -0.01, 0.3, 0.2) },
    {
      kind: 'convexPolygon',
      vertices: [
        { x: -0.2, y: -0.1 },
        { x: 0.3, y: -0.1 },
        { x: 0, y: 0.25 },
      ],
    },
  ];
  const statics: StaticSpec[] = [
    { id: 'floor', kind: 'halfPlane', point: { x: 0.3, y: -1 }, normal: { x: 0, y: 2 }, material },
    {
      id: 'slope',
      kind: 'halfPlane',
      point: { x: 1, y: -2 },
      normal: { x: -0.4, y: 0.9 },
      material,
    },
    { id: 'rock', kind: 'convexPolygon', vertices: convexPolygon(rng, 6, 3, 0, 1, 0.7), material },
  ];

  for (const shape of shapes) {
    for (const angle of ANGLES) {
      it(`${shape.kind} (${shape.kind === 'box' ? 'box' : `${shape.vertices.length} vertices`}) at angle ${angle.toFixed(3)}`, () => {
        const m = model(shape, angle, { x: 0.7, y: 1.3 }, statics);
        const row = createModelRow(m);
        const v = Float64Array.of(rng.uniform(-2, 2), rng.uniform(-2, 2));
        const contacts = m.constraints.filter((c): c is ContactConstraint => c.kind === 'contact');
        expect(contacts).toHaveLength(1 + 1 + 6);
        for (const c of contacts) {
          const spec = statics.find((s) => s.id === c.staticId);
          if (!spec) throw new Error('missing static');
          const face = faces(spec)[c.face];
          expect(c.id).toBe(`c:b:${c.staticId}:${c.face}`);
          const g = (q: ArrayLike<number>): number => {
            evalConstraint(c, 0, q, v, row);
            return row.value;
          };
          for (let trial = 0; trial < 3; trial++) {
            const q = Float64Array.of(rng.uniform(-2, 4), rng.uniform(-3, 3));
            // Brute force: min over world vertices of n·(x − a).
            const brute = Math.min(
              ...worldVertices(shape, angle, q).map(
                (w) => face.n.x * (w.x - face.a.x) + face.n.y * (w.y - face.a.y),
              ),
            );
            expect(Math.abs(g(q) - brute)).toBeLessThan(1e-14 * 16);
            expect(contactGap(c, q)).toBe(g(q));
            for (let i = 0; i < 2; i++) {
              const fd = directionalDerivative(g, q, unit(2, i));
              evalConstraint(c, 0, q, v, row);
              const Ji = row.idx[0] === i ? row.val[0] : row.val[1];
              expect(Math.abs(fd.value - Ji)).toBeLessThan(1e-12);
            }
            expect(row.curvature).toBe(0);
            expect(Math.abs(secondDirectionalDerivative(g, q, v).value)).toBeLessThan(1e-9);
          }
          // The tangent is n turned clockwise, and v_t = t·v.
          expect(c.tangent.x).toBe(c.normal.y);
          expect(c.tangent.y + c.normal.x).toBe(0);
          expect(Object.is(c.tangent.y, -0)).toBe(false);
          expect(contactTangentialVelocity(c, v)).toBe(c.tangent.x * v[0] + c.tangent.y * v[1]);
        }
      });
    }
  }
});

describe('contact validity domain (overlap) and contact point', () => {
  const table: StaticSpec = {
    id: 'table',
    kind: 'convexPolygon',
    vertices: [
      { x: -3, y: -1 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
      { x: -3, y: 0 },
    ],
    material,
  };

  it('a rotation-locked box stays supported until its whole bottom face has left the edge', () => {
    const m = model({ kind: 'box', w: 0.5, h: 0.25 }, 0, { x: -1, y: 0.125 }, [table]);
    const top = m.constraints[m.constraintIndex.get('c:b:table:2') ?? -1] as ContactConstraint;
    expect(top.normal).toEqual({ x: 0, y: 1 });
    expect(top.supportLo).toBe(-0.25);
    expect(top.supportHi).toBe(0.25);
    expect([top.faceLo, top.faceHi]).toEqual([-3, 0]);
    const at = (x: number): Float64Array => Float64Array.of(x, 0.125);
    expect(contactOverlap(top, at(-1))).toBe(1.25); // min(−0.75 − (−3), 0 − (−1.25))
    expect(contactOverlap(top, at(0.2))).toBeCloseTo(0.05, 15); // half the box past the edge: still on
    expect(contactOverlap(top, at(0.25))).toBe(0); // trailing edge exactly at the table's edge
    expect(contactOverlap(top, at(0.3))).toBeLessThan(0);
    expect(contactOverlap(top, at(-3.25))).toBe(0); // the other end of the face
    expect(contactPoint(top, at(-1))).toEqual({ x: -1, y: 0 });
    expect(contactPoint(top, at(0.125))).toEqual({ x: -0.0625, y: 0 }); // middle of the overlap
  });

  it('a tilted box is supported by its lowest vertex only', () => {
    const m = model({ kind: 'box', w: 0.5, h: 0.25 }, 0.2, { x: -1, y: 1 }, [table]);
    const top = m.constraints[m.constraintIndex.get('c:b:table:2') ?? -1] as ContactConstraint;
    expect(top.supportHi - top.supportLo).toBe(0);
  });

  it('a box face-aligned with an incline keeps its whole edge as the support feature', () => {
    const alpha = Math.PI / 6;
    const slope: StaticSpec = {
      id: 'slope',
      kind: 'halfPlane',
      point: { x: 0, y: 0 },
      normal: { x: -Math.sin(alpha), y: Math.cos(alpha) },
      material,
    };
    // Centre h/2 along the face normal from a point of the face.
    const position = { x: -0.125 * Math.sin(alpha), y: 0.125 * Math.cos(alpha) };
    const m = model({ kind: 'box', w: 0.5, h: 0.25 }, alpha, position, [slope]);
    const c = m.constraints[0] as ContactConstraint;
    expect(c.supportHi - c.supportLo).toBeCloseTo(0.5, 14);
    expect(Math.abs(contactGap(c, m.q0))).toBeLessThan(1e-16);
    expect(contactOverlap(c, m.q0)).toBe(Infinity);
  });
});
