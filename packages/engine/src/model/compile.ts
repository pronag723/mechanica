/**
 * compileModel: ModelSpec → Model (DESIGN §3.1). Lays out the DOFs, builds the constraint
 * instances with provenance, and checks the initial geometry. Any error diagnostic means no model:
 * the engine never simulates a scene it knows to be inconsistent.
 */
import { type Diagnostic, hasErrors } from '../diagnostics';
import { rotateVertices, shapeVertices } from '../geometry/shapes';
import { compareIds } from '../ids';
import type { ModelSpec } from '../spec';
import { buildContacts, penetrationDiagnostics } from './contacts';
import { computeScales } from './scales';
import { compileRoute, compileString } from './strings';
import type {
  Constraint,
  ContactConstraint,
  DofInfo,
  Model,
  ModelAppliedForce,
  ModelBody,
  StringConstraint,
} from './types';
import { validateSpec } from './validate';

/** Geometric tolerance at t₀, relative to the length scale L*: penetration, degenerate segments, overstretch. */
export const GEOMETRY_REL_TOL = 1e-9;

export interface CompileResult {
  /** null when any diagnostic is an error. */
  readonly model: Model | null;
  readonly diagnostics: readonly Diagnostic[];
}

export function compileModel(spec: ModelSpec): CompileResult {
  const { diagnostics } = validateSpec(spec);
  if (hasErrors(diagnostics)) return { model: null, diagnostics };

  // DOF layout: x, y per body, bodies in id order. Phase 6 inserts θ after y.
  const bodySpecs = [...spec.bodies].sort((a, b) => compareIds(a.id, b.id));
  const bodyIndex = new Map<string, number>();
  const dofs: DofInfo[] = [];
  const bodies: ModelBody[] = bodySpecs.map((b, index) => {
    bodyIndex.set(b.id, index);
    const dofX = dofs.length;
    dofs.push({ kind: 'x', body: b.id }, { kind: 'y', body: b.id });
    const angle = b.angle ?? 0;
    return {
      id: b.id,
      index,
      symbol: b.symbol,
      mass: b.mass,
      angle,
      dofX,
      dofY: dofX + 1,
      offsets: rotateVertices(shapeVertices(b.shape), angle),
    };
  });
  const nDof = dofs.length;
  const mass = new Float64Array(nDof);
  const q0 = new Float64Array(nDof);
  const v0 = new Float64Array(nDof);
  bodySpecs.forEach((b, i) => {
    const { dofX, dofY } = bodies[i];
    mass[dofX] = mass[dofY] = b.mass;
    q0[dofX] = b.position.x;
    q0[dofY] = b.position.y;
    v0[dofX] = b.velocity?.x ?? 0;
    v0[dofY] = b.velocity?.y ?? 0;
  });

  const scales = computeScales(spec, bodies, q0);
  const tol = GEOMETRY_REL_TOL * scales.length;

  const constraints: (Omit<StringConstraint, 'index'> | Omit<ContactConstraint, 'index'>)[] = [];
  let maxRouteNodes = 2;
  for (const s of [...spec.strings].sort((a, b) => compareIds(a.id, b.id))) {
    const nodes = compileRoute(s, spec, bodies, bodyIndex);
    maxRouteNodes = Math.max(maxRouteNodes, nodes.length);
    const c = compileString(s, nodes, q0, tol, diagnostics);
    if (c) constraints.push(c);
  }
  const statics = [...spec.statics].sort((a, b) => compareIds(a.id, b.id));
  constraints.push(...buildContacts(bodies, statics, spec.pairOverrides ?? []));
  diagnostics.push(...penetrationDiagnostics(bodies, statics, q0, tol));
  if (hasErrors(diagnostics)) return { model: null, diagnostics };

  constraints.sort((a, b) => compareIds(a.id, b.id));
  const indexed: Constraint[] = constraints.map((c, index) =>
    c.kind === 'string' ? { ...c, index } : { ...c, index },
  );

  const appliedForces: ModelAppliedForce[] = [...(spec.appliedForces ?? [])]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((f) => {
      const b = bodies[bodyIndex.get(f.body) ?? -1];
      return {
        id: f.id,
        symbol: f.symbol ?? 'F',
        body: b.id,
        dofX: b.dofX,
        dofY: b.dofY,
        force: { x: f.force.x, y: f.force.y },
      };
    });

  const model: Model = {
    gravity: { x: spec.gravity.x, y: spec.gravity.y },
    scales,
    bodies,
    bodyIndex,
    pulleys: [...spec.pulleys]
      .sort((a, b) => compareIds(a.id, b.id))
      .map((p) => ({ id: p.id, center: { x: p.center.x, y: p.center.y }, radius: p.radius })),
    appliedForces,
    constraints: indexed,
    constraintIndex: new Map(indexed.map((c) => [c.id, c.index])),
    nDof,
    dofs,
    mass,
    q0,
    v0,
    maxRouteNodes,
    options: { ...spec.options },
  };
  return { model, diagnostics };
}
