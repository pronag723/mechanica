/**
 * Contact candidates (one per body × support face) and the separating-axis penetration check.
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import { faceTangent, outwardNormal, supportFeature } from '../geometry/shapes';
import { contactId } from '../ids';
import type { Material, PairOverride, StaticSpec, Vec2 } from '../spec';
import type { ContactConstraint, ModelBody } from './types';

interface Face {
  readonly normal: Vec2;
  readonly tangent: Vec2;
  readonly offset: number;
  readonly lo: number;
  readonly hi: number;
}

/** Faces of a support with outward unit normals, offsets and extents along their tangents. */
export function staticFaces(s: StaticSpec): Face[] {
  if (s.kind === 'halfPlane') {
    const len = Math.hypot(s.normal.x, s.normal.y);
    const normal = { x: s.normal.x / len, y: s.normal.y / len };
    const offset = normal.x * s.point.x + normal.y * s.point.y;
    return [{ normal, tangent: faceTangent(normal), offset, lo: -Infinity, hi: Infinity }];
  }
  const vs = s.vertices;
  return vs.map((a, i) => {
    const b = vs[(i + 1) % vs.length];
    const normal = outwardNormal(a, b);
    const tangent = faceTangent(normal);
    const ta = tangent.x * a.x + tangent.y * a.y;
    const tb = tangent.x * b.x + tangent.y * b.y;
    return {
      normal,
      tangent,
      offset: normal.x * a.x + normal.y * a.y,
      lo: Math.min(ta, tb),
      hi: Math.max(ta, tb),
    };
  });
}

/** The pair's material: the support's, with matching pair overrides applied in order. */
export function pairMaterial(
  bodyId: string,
  s: StaticSpec,
  overrides: readonly PairOverride[],
): Material {
  let m: Material = s.material;
  for (const o of overrides) {
    if ((o.a === bodyId && o.b === s.id) || (o.a === s.id && o.b === bodyId)) {
      m = {
        muS: o.muS ?? m.muS,
        muK: o.muK ?? m.muK,
        restitution: o.restitution ?? m.restitution,
      };
    }
  }
  return m;
}

type ContactDraft = Omit<ContactConstraint, 'index'>;

export function buildContacts(
  bodies: readonly ModelBody[],
  statics: readonly StaticSpec[],
  overrides: readonly PairOverride[],
): ContactDraft[] {
  const out: ContactDraft[] = [];
  for (const b of bodies) {
    for (const s of statics) {
      const material = pairMaterial(b.id, s, overrides);
      staticFaces(s).forEach((f, face) => {
        const feature = supportFeature(b.offsets, f.normal);
        out.push({
          kind: 'contact',
          id: contactId(b.id, s.id, face),
          sided: 'unilateral',
          linear: true,
          provenance: { elementId: b.id, kind: 'contact', symbol: 'N' },
          elementIds: [b.id, s.id],
          body: b.id,
          dofX: b.dofX,
          dofY: b.dofY,
          staticId: s.id,
          face,
          normal: f.normal,
          tangent: f.tangent,
          offset: f.offset,
          depth: feature.depth,
          supportLo: feature.lo,
          supportHi: feature.hi,
          faceLo: f.lo,
          faceHi: f.hi,
          material,
        });
      });
    }
  }
  return out;
}

/**
 * Separating-axis test for a body at q against a support: the largest signed separation over the
 * support's face normals and (for polygons) the body's face normals. Negative means overlap by
 * that depth.
 */
export function staticSeparation(b: ModelBody, s: StaticSpec, q: ArrayLike<number>): number {
  const px = q[b.dofX];
  const py = q[b.dofY];
  let sep = -Infinity;
  for (const f of staticFaces(s)) {
    let lowest = Infinity;
    for (const o of b.offsets)
      lowest = Math.min(lowest, f.normal.x * (px + o.x) + f.normal.y * (py + o.y));
    sep = Math.max(sep, lowest - f.offset);
  }
  if (s.kind === 'convexPolygon') {
    const n = b.offsets.length;
    for (let i = 0; i < n; i++) {
      const a = b.offsets[i];
      const m = outwardNormal(a, b.offsets[(i + 1) % n]);
      const faceOffset = m.x * (px + a.x) + m.y * (py + a.y);
      let lowest = Infinity;
      for (const w of s.vertices) lowest = Math.min(lowest, m.x * w.x + m.y * w.y);
      sep = Math.max(sep, lowest - faceOffset);
    }
  }
  return sep;
}

/** BODY_PENETRATES_STATIC for every body that overlaps a support by more than `tol` at q. */
export function penetrationDiagnostics(
  bodies: readonly ModelBody[],
  statics: readonly StaticSpec[],
  q: ArrayLike<number>,
  tol: number,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const b of bodies) {
    for (const s of statics) {
      const sep = staticSeparation(b, s, q);
      if (sep < -tol) {
        out.push(
          diagnostic(
            'BODY_PENETRATES_STATIC',
            'error',
            [b.id, s.id],
            { depth: -sep },
            `Body "${b.id}" penetrates support "${s.id}" by ${(-sep).toExponential(3)} m at t₀.`,
          ),
        );
      }
    }
  }
  return out;
}
