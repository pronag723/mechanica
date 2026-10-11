import { describe, expect, it } from 'vitest';
import { createRng } from '../../tests/helpers/prng';
import { referencePath } from '../../tests/helpers/string-reference';
import type { Vec2 } from '../spec';
import { type PathPulley, type StringPath, stringPath, turnAngle } from './string-path';

const v = (x: number, y: number): Vec2 => ({ x, y });

function okPath(p: StringPath): Extract<StringPath, { ok: true }> {
  if (!p.ok) throw new Error(`no path: segment ${p.segment}`);
  return p;
}

describe('stringPath: tangent constructions', () => {
  it('point to point is the straight segment', () => {
    const p = okPath(stringPath(v(1, 2), [], v(4, 6)));
    expect(p.length).toBe(5);
    expect(p.segments[0].direction).toEqual({ x: 0.6, y: 0.8 });
    expect(p.arcs).toEqual([]);
  });

  it('Atwood geometry: vertical segments, half a turn on the pulley', () => {
    const R = 0.25;
    const p = okPath(
      stringPath(v(-R, -1.875), [{ id: 'P', center: v(0, 0), radius: R, wrap: 'cw' }], v(R, -1.5)),
    );
    expect(p.segments[0].to).toEqual({ x: -R, y: 0 });
    expect(p.segments[0].direction).toEqual({ x: 0, y: 1 });
    expect(p.segments[1].from).toEqual({ x: R, y: 0 });
    expect(p.segments[1].direction).toEqual({ x: 0, y: -1 });
    expect(p.arcs[0].angle).toBe(Math.PI);
    expect(p.arcs[0].pulley).toBe('P');
    expect(p.length).toBeCloseTo(1.875 + 1.5 + Math.PI * R, 14);
  });

  it('point to circle and circle to point pick the tangent by the wrap side', () => {
    // From (−2, 0) to a unit circle at the origin: tangent length √3, touching at (−½, ±√3/2).
    for (const wrap of ['cw', 'ccw'] as const) {
      const p = okPath(stringPath(v(-2, 0), [{ center: v(0, 0), radius: 1, wrap }], v(2, 0)));
      const touch = p.segments[0].to;
      expect(p.segments[0].length).toBeCloseTo(Math.sqrt(3), 15);
      expect(touch.x).toBeCloseTo(-0.5, 15);
      // cw keeps the centre on the right: the string passes above; ccw passes below.
      expect(Math.sign(touch.y)).toBe(wrap === 'cw' ? 1 : -1);
      expect(p.segments[1].length).toBeCloseTo(Math.sqrt(3), 15);
      // Tangent points at polar angles 120° and 60° (or −120°, −60°): the arc spans π/3.
      expect(p.arcs[0].angle).toBeCloseTo(Math.PI / 3, 14);
    }
  });

  it('circle to circle: external tangent for the same side, internal for opposite sides', () => {
    const r1 = 0.5;
    const r2 = 0.25;
    const d = 3;
    for (const [w1, w2] of [
      ['cw', 'cw'],
      ['ccw', 'ccw'],
      ['cw', 'ccw'],
      ['ccw', 'cw'],
    ] as const) {
      const p = okPath(
        stringPath(
          v(-1, -5),
          [
            { center: v(0, 0), radius: r1, wrap: w1 },
            { center: v(d, 0), radius: r2, wrap: w2 },
          ],
          v(4, -5),
        ),
      );
      const expected =
        w1 === w2 ? Math.sqrt(d * d - (r1 - r2) ** 2) : Math.sqrt(d * d - (r1 + r2) ** 2);
      expect(p.segments[1].length).toBeCloseTo(expected, 14);
    }
  });

  it('a point pulley (R = 0) gives a polyline whose wrap is the turning angle', () => {
    const p = okPath(stringPath(v(-1, -1), [{ center: v(0, 0), radius: 0, wrap: 'cw' }], v(1, -1)));
    expect(p.length).toBeCloseTo(2 * Math.SQRT2, 15);
    expect(p.arcs[0].from).toEqual({ x: 0, y: 0 });
    expect(p.arcs[0].angle).toBeCloseTo(Math.PI / 2, 15);
    const q = okPath(
      stringPath(v(-1, -1), [{ center: v(0, 0), radius: 0, wrap: 'ccw' }], v(1, -1)),
    );
    expect(q.length).toBe(p.length); // R·wrap vanishes; only the reported angle differs
    expect(q.arcs[0].angle).toBeCloseTo((3 * Math.PI) / 2, 15);
  });

  it('reports a missing tangent: an end inside a pulley, overlapping crossed pulleys', () => {
    expect(stringPath(v(0.1, 0), [{ center: v(0, 0), radius: 0.5, wrap: 'cw' }], v(3, 0))).toEqual({
      ok: false,
      segment: 0,
      reason: 'tangentMissing',
    });
    const crossed = stringPath(
      v(-2, 0),
      [
        { center: v(0, 0), radius: 0.5, wrap: 'cw' },
        { center: v(0.8, 0), radius: 0.5, wrap: 'ccw' },
      ],
      v(3, 0),
    );
    expect(crossed).toMatchObject({ ok: false, segment: 1 });
  });

  it('turnAngle measures in the wrap sense, in [0, 2π)', () => {
    expect(turnAngle(1, 0, 0, 1, 1)).toBeCloseTo(Math.PI / 2, 15);
    expect(turnAngle(1, 0, 0, 1, -1)).toBeCloseTo((3 * Math.PI) / 2, 15);
    expect(turnAngle(1, 0, 1, 0, 1)).toBe(0);
    expect(turnAngle(0, 1, 0, -1, 1)).toBeCloseTo(Math.PI, 15);
    expect(turnAngle(0, 1, 0, -1, -1)).toBeCloseTo(Math.PI, 15);
  });
});

describe('stringPath: properties on random routes', () => {
  const rng = createRng(20261011);
  const randomRoute = (): { start: Vec2; vias: PathPulley[]; end: Vec2 } => {
    const count = rng.int(1, 3);
    const vias: PathPulley[] = [];
    for (let k = 0; k < count; k++) {
      vias.push({
        id: `p${k}`,
        center: v(rng.uniform(-3, 3), rng.uniform(-3, 3)),
        radius: rng.next() < 0.2 ? 0 : rng.uniform(0.05, 0.6),
        wrap: rng.next() < 0.5 ? 'cw' : 'ccw',
      });
    }
    return {
      start: v(rng.uniform(-4, 4), rng.uniform(-4, 4)),
      vias,
      end: v(rng.uniform(-4, 4), rng.uniform(-4, 4)),
    };
  };

  it('tangent points lie on the circles, segments are tangent, centres on the wrap side', () => {
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const { start, vias, end } = randomRoute();
      const p = stringPath(start, vias, end);
      if (!p.ok) continue;
      checked++;
      p.arcs.forEach((arc, k) => {
        const sense = arc.wrap === 'ccw' ? 1 : -1;
        const into = p.segments[k];
        const out = p.segments[k + 1];
        for (const [T, d] of [
          [into.to, into.direction],
          [out.from, out.direction],
        ] as const) {
          const rx = T.x - arc.center.x;
          const ry = T.y - arc.center.y;
          expect(Math.abs(Math.hypot(rx, ry) - arc.radius)).toBeLessThan(1e-14 * 8);
          expect(Math.abs(rx * d.x + ry * d.y)).toBeLessThan(1e-14 * 8); // radius ⊥ string
          // n(d)·(c − T) = ρ = sense·R: the centre is on the left for ccw, on the right for cw.
          expect(-d.y * -rx + d.x * -ry).toBeCloseTo(sense * arc.radius, 13);
        }
        // Arc angles agree with the tangent points (for R > 0).
        if (arc.radius > 0) {
          const ang = (P: Vec2): number => Math.atan2(P.y - arc.center.y, P.x - arc.center.x);
          expect(Math.cos(ang(arc.from) - arc.startAngle)).toBeCloseTo(1, 13);
          expect(Math.cos(ang(arc.to) - arc.endAngle)).toBeCloseTo(1, 13);
        }
      });
      for (const s of p.segments)
        expect(Math.hypot(s.direction.x, s.direction.y)).toBeCloseTo(1, 15);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('matches an independent angle-based construction', () => {
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const { start, vias, end } = randomRoute();
      const p = stringPath(start, vias, end);
      if (!p.ok) continue;
      const ref = referencePath(start, vias, end);
      // Away from the 0/2π cut, where the two reductions may legitimately disagree.
      if (ref.wraps.some((w) => w < 1e-6 || w > 2 * Math.PI - 1e-6)) continue;
      checked++;
      expect(Math.abs(p.length - ref.length)).toBeLessThan(1e-13 * Math.max(1, ref.length));
      p.segments.forEach((s, k) => expect(s.length).toBeCloseTo(ref.segmentLengths[k], 13));
      p.arcs.forEach((a, k) => expect(a.angle).toBeCloseTo(ref.wraps[k], 12));
    }
    expect(checked).toBeGreaterThan(150);
  });
});
