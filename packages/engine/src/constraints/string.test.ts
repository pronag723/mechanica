import { afterAll, describe, expect, it } from 'vitest';
import { directionalDerivative, secondDirectionalDerivative, unit } from '../../tests/helpers/fd';
import { type Rng, createRng } from '../../tests/helpers/prng';
import { referencePath } from '../../tests/helpers/string-reference';
import { compileModel } from '../model/compile';
import type { Model, StringConstraint } from '../model/types';
import type { ModelSpec, RouteNode, Vec2, Wrap } from '../spec';
import { createModelRow, evalConstraint, rowDot } from '.';
import { stringGeometry } from './string';

type EndKind = 'body' | 'fixed';
interface Case {
  readonly name: string;
  readonly first: EndKind;
  /** 'same' ties the last end to the first end's body as well. */
  readonly last: EndKind | 'same';
  readonly vias: readonly { readonly wrap: Wrap; readonly zeroRadius?: boolean }[];
}

const CASES: Case[] = [
  { name: 'no pulley, fixed point to body', first: 'fixed', last: 'body', vias: [] },
  { name: 'no pulley, body to body', first: 'body', last: 'body', vias: [] },
  { name: 'no pulley, body to fixed point', first: 'body', last: 'fixed', vias: [] },
  { name: '1 pulley cw, body to body', first: 'body', last: 'body', vias: [{ wrap: 'cw' }] },
  { name: '1 pulley ccw, body to body', first: 'body', last: 'body', vias: [{ wrap: 'ccw' }] },
  {
    name: '1 pulley cw, fixed point to body',
    first: 'fixed',
    last: 'body',
    vias: [{ wrap: 'cw' }],
  },
  {
    name: '1 pulley ccw, body to fixed point',
    first: 'body',
    last: 'fixed',
    vias: [{ wrap: 'ccw' }],
  },
  {
    name: '1 pulley R = 0, body to body',
    first: 'body',
    last: 'body',
    vias: [{ wrap: 'cw', zeroRadius: true }],
  },
  {
    name: '1 pulley R = 0, fixed point to body',
    first: 'fixed',
    last: 'body',
    vias: [{ wrap: 'ccw', zeroRadius: true }],
  },
  {
    name: '2 pulleys, same side (cw, cw)',
    first: 'body',
    last: 'body',
    vias: [{ wrap: 'cw' }, { wrap: 'cw' }],
  },
  {
    name: '2 pulleys, same side (ccw, ccw)',
    first: 'fixed',
    last: 'body',
    vias: [{ wrap: 'ccw' }, { wrap: 'ccw' }],
  },
  {
    name: '2 pulleys, opposite sides (cw, ccw)',
    first: 'body',
    last: 'body',
    vias: [{ wrap: 'cw' }, { wrap: 'ccw' }],
  },
  {
    name: '2 pulleys, opposite sides (ccw, cw)',
    first: 'body',
    last: 'fixed',
    vias: [{ wrap: 'ccw' }, { wrap: 'cw' }],
  },
  {
    name: '2 pulleys, R = 0 and R > 0',
    first: 'body',
    last: 'body',
    vias: [{ wrap: 'cw', zeroRadius: true }, { wrap: 'ccw' }],
  },
  { name: 'both ends on one body, 1 pulley', first: 'body', last: 'same', vias: [{ wrap: 'cw' }] },
];

const p = (rng: Rng, s: number): Vec2 => ({ x: rng.uniform(-s, s), y: rng.uniform(-s, s) });

/** A random model with one string of the given shape, or null if its geometry is not generic. */
function randomModel(rng: Rng, c: Case): Model | null {
  const bodies: ModelSpec['bodies'][number][] = [];
  const end = (kind: EndKind, id: string): RouteNode => {
    if (kind === 'fixed') return { kind: 'fixed', point: p(rng, 3) };
    if (!bodies.some((b) => b.id === id)) {
      bodies.push({
        id,
        mass: 1,
        shape: { kind: 'box', w: 0.2, h: 0.2 },
        angle: rng.uniform(-1, 1),
        position: p(rng, 3),
      });
    }
    return { kind: 'body', body: id, anchor: p(rng, 0.1) };
  };
  const pulleys = c.vias.map((via, k) => ({
    id: `p${k}`,
    center: p(rng, 2),
    radius: via.zeroRadius ? 0 : rng.uniform(0.1, 0.5),
  }));
  const route: RouteNode[] = [
    end(c.first, 'A'),
    ...c.vias.map((via, k): RouteNode => ({ kind: 'pulley', pulley: `p${k}`, wrap: via.wrap })),
    c.last === 'same' ? end('body', 'A') : end(c.last, 'B'),
  ];
  const spec: ModelSpec = {
    gravity: { x: 0, y: -9.8 },
    bodies,
    statics: [],
    pulleys,
    strings: [{ id: 's', route }],
    options: { horizon: 1 },
  };
  const { model } = compileModel(spec);
  if (!model) return null;
  const geo = stringGeometry(model, 's', model.q0);
  if (!geo.ok) return null;
  // Generic configurations only: finite differences need room around q.
  if (geo.segments.some((s) => s.length < 0.3)) return null;
  if (geo.arcs.some((a) => a.angle < 0.3 || a.angle > 2 * Math.PI - 0.3)) return null;
  return model;
}

function* configurations(c: Case, seed: number, count: number): Generator<Model> {
  const rng = createRng(seed);
  let found = 0;
  for (let attempt = 0; found < count && attempt < 2000; attempt++) {
    const model = randomModel(rng, c);
    if (model) {
      found++;
      yield model;
    }
  }
  if (found < count) throw new Error(`${c.name}: only ${found} generic configurations`);
}

const PER_CASE = 6;
const worst = { gradient: 0, curvature2: 0, curvatureJv: 0 };

describe('string constraint: value, gradient and curvature against finite differences', () => {
  afterAll(() => {
    console.log(
      `string FD worst errors: gradient ${worst.gradient.toExponential(2)}, ` +
        `curvature (2nd difference) ${worst.curvature2.toExponential(2)}, ` +
        `curvature (d/ds J·v) ${worst.curvatureJv.toExponential(2)}`,
    );
  });
  CASES.forEach((c, caseIndex) => {
    it(c.name, () => {
      const vrng = createRng(1000 + caseIndex);
      for (const model of configurations(c, 77 + caseIndex, PER_CASE)) {
        const con = model.constraints[0] as StringConstraint;
        const row = createModelRow(model);
        const n = model.nDof;
        const v = Float64Array.from({ length: n }, () => vrng.uniform(-2, 2));
        const g = (q: ArrayLike<number>): number => {
          evalConstraint(con, 0, q, v, row);
          return row.value;
        };

        // Value: taut at t₀ by default, and L(q) matches the angle-based construction elsewhere.
        expect(g(model.q0)).toBe(0);
        const q1 = Float64Array.from(model.q0, (x) => x + vrng.uniform(-0.05, 0.05));
        const world = (node: StringConstraint['nodes'][number]): Vec2 =>
          node.kind === 'body'
            ? { x: q1[node.dofX] + node.anchor.x, y: q1[node.dofY] + node.anchor.y }
            : node.kind === 'fixed'
              ? node.point
              : node.center;
        const vias = con.nodes.flatMap((node) => (node.kind === 'pulley' ? [node] : []));
        const ref = referencePath(
          world(con.nodes[0]),
          vias,
          world(con.nodes[con.nodes.length - 1]),
        );
        expect(Math.abs(con.restLength - g(q1) - ref.length)).toBeLessThan(1e-13 * ref.length);

        // Gradient: J_i = ∂g/∂q_i.
        evalConstraint(con, 0, model.q0, v, row);
        const J = new Float64Array(n);
        for (let k = 0; k < row.nnz; k++) J[row.idx[k]] = row.val[k];
        const curvature = row.curvature;
        for (let i = 0; i < n; i++) {
          const fd = directionalDerivative(g, model.q0, unit(n, i));
          worst.gradient = Math.max(worst.gradient, Math.abs(fd.value - J[i]));
          expect(Math.abs(fd.value - J[i])).toBeLessThan(1e-9);
        }
        // A body end's gradient is a unit vector (the ends here are on distinct bodies, except 'same').
        if (c.last !== 'same') {
          for (const b of model.bodies) {
            expect(Math.hypot(J[b.dofX], J[b.dofY])).toBeCloseTo(1, 14);
          }
        }

        // Curvature: d²/ds² g(q + s·v) = J̇v (straight-line motion, a = 0) ...
        const fd2 = secondDirectionalDerivative(g, model.q0, v);
        const scale = Math.max(1, Math.abs(curvature));
        worst.curvature2 = Math.max(worst.curvature2, Math.abs(fd2.value - curvature) / scale);
        expect(Math.abs(fd2.value - curvature)).toBeLessThan(
          1e-9 * Math.max(1, Math.abs(curvature)),
        );
        // ... and d/ds [J(q + s·v)·v] = J̇v, from the (already checked) analytic gradient.
        const Jv = (q: ArrayLike<number>): number => {
          evalConstraint(con, 0, q, v, row);
          return rowDot(row, v);
        };
        const fd3 = directionalDerivative(Jv, model.q0, v);
        worst.curvatureJv = Math.max(worst.curvatureJv, Math.abs(fd3.value - curvature) / scale);
        expect(Math.abs(fd3.value - curvature)).toBeLessThan(
          1e-10 * Math.max(1, Math.abs(curvature)),
        );
        // J̇v = −Σ(Δv × d)²/ℓ ≤ 0: L is convex along straight-line motions of the ends.
        expect(curvature).toBeLessThanOrEqual(0);
      }
    });
  });
});

describe('stringGeometry', () => {
  it('reports the same length as the constraint and throws on unknown ids', () => {
    const model = [...configurations(CASES[11], 9, 1)][0];
    const geo = stringGeometry(model, 's', model.q0);
    if (!geo.ok) throw new Error('expected a path');
    expect(geo.restLength).toBe(geo.length);
    expect(geo.id).toBe('s');
    expect(geo.segments).toHaveLength(3);
    expect(geo.arcs.map((a) => a.pulley)).toEqual(['p0', 'p1']);
    expect(() => stringGeometry(model, 'nope', model.q0)).toThrow(RangeError);
  });
});
