/**
 * Structural validation of a ModelSpec before compiling: ids, numbers, shapes, references and
 * route structure. Everything wrong is reported as a diagnostic; nothing throws.
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import { polygonProblem } from '../geometry/shapes';
import type { Material, ModelSpec, RouteNode, Vec2 } from '../spec';

export type ElementKind = 'body' | 'static' | 'pulley' | 'string' | 'appliedForce' | 'query';

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const finiteVec = (v: Vec2 | undefined): boolean => v !== undefined && finite(v.x) && finite(v.y);

export function validateSpec(spec: ModelSpec): {
  diagnostics: Diagnostic[];
  kinds: Map<string, ElementKind>;
} {
  const out: Diagnostic[] = [];
  const kinds = new Map<string, ElementKind>();

  const visitId = (id: string, kind: ElementKind): void => {
    if (typeof id !== 'string' || id === '') {
      out.push(
        diagnostic(
          'INVALID_ID',
          'error',
          [],
          { kind, reason: 'empty' },
          `A ${kind} has an empty id.`,
        ),
      );
    } else if (id.includes(':')) {
      out.push(
        diagnostic(
          'INVALID_ID',
          'error',
          [id],
          { kind, reason: 'reservedCharacter' },
          `Id "${id}" contains ':', which is reserved for derived ids.`,
        ),
      );
    } else if (kinds.has(id)) {
      out.push(
        diagnostic(
          'INVALID_ID',
          'error',
          [id],
          { kind, reason: 'duplicate' },
          `Id "${id}" is used by more than one element.`,
        ),
      );
    } else {
      kinds.set(id, kind);
    }
  };
  /** `owner`: the element's id, or the ids of a pair; '' for model-level fields. */
  const bad = (
    owner: string | readonly string[],
    field: string,
    reason: string,
    what: string,
  ): void => {
    const ids = typeof owner === 'string' ? (owner ? [owner] : []) : owner;
    const label = ids.length > 0 ? ids.map((id) => `"${id}"`).join('–') : 'Model';
    out.push(
      diagnostic(
        'INVALID_PARAMETER',
        'error',
        ids,
        { field, reason },
        `${label}: ${field} ${what}.`,
      ),
    );
  };
  const checkMaterial = (
    owner: string | readonly string[],
    prefix: string,
    m: Partial<Material>,
    required: boolean,
  ): void => {
    for (const field of ['muS', 'muK'] as const) {
      const x = m[field];
      if (x === undefined ? required : !(finite(x) && x >= 0))
        bad(owner, `${prefix}${field}`, 'outOfRange', 'must be a finite number ≥ 0');
    }
    const e = m.restitution;
    if (e === undefined ? required : !(finite(e) && e >= 0 && e <= 1))
      bad(owner, `${prefix}restitution`, 'outOfRange', 'must be in [0, 1]');
  };
  const refTo = (owner: string, field: string, ref: string, expected: ElementKind): boolean => {
    if (kinds.get(ref) === expected) return true;
    out.push(
      diagnostic(
        'UNKNOWN_REFERENCE',
        'error',
        [owner],
        { field, ref, expected },
        `"${owner}": ${field} refers to "${ref}", which is not a ${expected}.`,
      ),
    );
    return false;
  };

  for (const b of spec.bodies) visitId(b.id, 'body');
  for (const s of spec.statics) visitId(s.id, 'static');
  for (const p of spec.pulleys) visitId(p.id, 'pulley');
  for (const s of spec.strings) visitId(s.id, 'string');
  for (const f of spec.appliedForces ?? []) visitId(f.id, 'appliedForce');
  for (const qs of spec.queries ?? []) visitId(qs.id, 'query');

  if (!finiteVec(spec.gravity)) bad('', 'gravity', 'notFinite', 'must be a finite vector');
  const o = spec.options;
  if (!(finite(o.horizon) && o.horizon > 0))
    bad('', 'options.horizon', 'outOfRange', 'must be > 0');
  if (o.rtol !== undefined && !(finite(o.rtol) && o.rtol > 0))
    bad('', 'options.rtol', 'outOfRange', 'must be > 0');
  if (o.atol !== undefined && !(finite(o.atol) && o.atol > 0))
    bad('', 'options.atol', 'outOfRange', 'must be > 0');
  if (o.maxEvents !== undefined && !(Number.isInteger(o.maxEvents) && o.maxEvents >= 1))
    bad('', 'options.maxEvents', 'outOfRange', 'must be an integer ≥ 1');

  for (const b of spec.bodies) {
    if (!(finite(b.mass) && b.mass >= 0)) bad(b.id, 'mass', 'outOfRange', 'must be ≥ 0');
    if (b.angle !== undefined && !finite(b.angle))
      bad(b.id, 'angle', 'notFinite', 'must be finite');
    if (!finiteVec(b.position)) bad(b.id, 'position', 'notFinite', 'must be finite');
    if (b.velocity !== undefined && !finiteVec(b.velocity))
      bad(b.id, 'velocity', 'notFinite', 'must be finite');
    const shape = b.shape;
    if (shape.kind === 'box') {
      if (!(finite(shape.w) && shape.w > 0 && finite(shape.h) && shape.h > 0))
        bad(b.id, 'shape', 'outOfRange', 'must have w > 0 and h > 0');
    } else if (shape.kind === 'convexPolygon') {
      const problem = polygonProblem(shape.vertices);
      if (problem)
        out.push(
          diagnostic(
            'SHAPE_INVALID',
            'error',
            [b.id],
            { reason: problem },
            `"${b.id}": the shape is not a valid convex polygon (${problem}).`,
          ),
        );
    } else {
      bad(b.id, 'shape.kind', 'unknown', 'is not a known shape kind');
    }
  }

  for (const s of spec.statics) {
    if (s.kind === 'halfPlane') {
      if (!finiteVec(s.point)) bad(s.id, 'point', 'notFinite', 'must be finite');
      if (!finiteVec(s.normal) || (s.normal.x === 0 && s.normal.y === 0))
        bad(s.id, 'normal', 'zeroVector', 'must be a finite nonzero vector');
    } else if (s.kind === 'convexPolygon') {
      const problem = polygonProblem(s.vertices);
      if (problem)
        out.push(
          diagnostic(
            'SHAPE_INVALID',
            'error',
            [s.id],
            { reason: problem },
            `"${s.id}": the support is not a valid convex polygon (${problem}).`,
          ),
        );
    } else {
      bad((s as { id: string }).id, 'kind', 'unknown', 'is not a known support kind');
      continue;
    }
    checkMaterial(s.id, 'material.', s.material, true);
  }

  for (const p of spec.pulleys) {
    if (!finiteVec(p.center)) bad(p.id, 'center', 'notFinite', 'must be finite');
    if (!(finite(p.radius) && p.radius >= 0)) bad(p.id, 'radius', 'outOfRange', 'must be ≥ 0');
  }

  for (const s of spec.strings) validateRoute(s.id, s.route, refTo, bad, out);
  for (const s of spec.strings) {
    if (s.restLength !== undefined && !(finite(s.restLength) && s.restLength > 0))
      bad(s.id, 'restLength', 'outOfRange', 'must be > 0');
  }

  for (const f of spec.appliedForces ?? []) {
    refTo(f.id, 'body', f.body, 'body');
    if (!finiteVec(f.force)) bad(f.id, 'force', 'notFinite', 'must be finite');
  }

  (spec.pairOverrides ?? []).forEach((po, k) => {
    const owner = `pairOverrides[${k}]`;
    const ka = kinds.get(po.a);
    const kb = kinds.get(po.b);
    const ok = (ka === 'body' && kb === 'static') || (ka === 'static' && kb === 'body');
    if (!ok) {
      out.push(
        diagnostic(
          'UNKNOWN_REFERENCE',
          'error',
          [po.a, po.b].filter((id) => kinds.has(id)),
          { field: owner, ref: `${po.a}|${po.b}`, expected: 'body+static' },
          `${owner} must name one body and one static support.`,
        ),
      );
    }
    checkMaterial(
      [po.a, po.b].filter((id) => kinds.has(id)),
      `${owner}.`,
      po,
      false,
    );
  });

  return { diagnostics: out, kinds };
}

function validateRoute(
  id: string,
  route: readonly RouteNode[],
  refTo: (owner: string, field: string, ref: string, expected: ElementKind) => boolean,
  bad: (id: string, field: string, reason: string, what: string) => void,
  out: Diagnostic[],
): void {
  const invalid = (reason: string, what: string): void => {
    out.push(
      diagnostic('STRING_ROUTE_INVALID', 'error', [id], { reason }, `String "${id}": ${what}.`),
    );
  };
  if (route.length < 2) {
    invalid('tooShort', 'a route needs two ends');
    return;
  }
  let bodyEnds = 0;
  route.forEach((node, i) => {
    const isEnd = i === 0 || i === route.length - 1;
    const field = `route[${i}]`;
    if (isEnd) {
      if (node.kind === 'body') {
        bodyEnds++;
        refTo(id, `${field}.body`, node.body, 'body');
        if (!finiteVec(node.anchor)) bad(id, `${field}.anchor`, 'notFinite', 'must be finite');
      } else if (node.kind === 'fixed') {
        if (!finiteVec(node.point)) bad(id, `${field}.point`, 'notFinite', 'must be finite');
      } else {
        invalid('endNotEnd', `${field} must be a body or a fixed point`);
      }
    } else if (node.kind === 'pulley') {
      refTo(id, `${field}.pulley`, node.pulley, 'pulley');
      if (node.wrap !== 'cw' && node.wrap !== 'ccw')
        invalid('wrapUnknown', `${field}.wrap must be cw or ccw`);
      const prev = route[i - 1];
      if (prev.kind === 'pulley' && prev.pulley === node.pulley)
        invalid('repeatedPulley', `${field} repeats the previous pulley`);
    } else {
      invalid('viaNotPulley', `${field} must be a pulley`);
    }
  });
  if (bodyEnds === 0) invalid('noBody', 'neither end is attached to a body');
}
