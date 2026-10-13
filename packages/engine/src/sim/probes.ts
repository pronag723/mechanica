/**
 * Probe evaluation (DESIGN §4.2): one function over a state and the forces of its mode, shared by
 * the simulator's query guards and the trajectory API (probeValue, sampleProbe).
 */
import type { Model, ModelBody } from '../model/types';
import type { Mode } from '../mode';
import type { Axis, ProbeRef } from '../spec';

/** Numeric codes of `contactRegime`. */
export const CONTACT_REGIME = { inactive: 0, stick: 1, slipPos: 2, slipNeg: 3 } as const;

/** Accelerations and multipliers of the state's mode (lazily computed by the caller). */
export interface ProbeForces {
  readonly a: ArrayLike<number>;
  /** Tension or normal force of an active constraint (NaN if not determined). */
  lambda(id: string): number;
  /** Signed friction along +t of an active contact (NaN if not determined). */
  friction(id: string): number;
}

export interface ProbeState {
  readonly q: ArrayLike<number>;
  readonly v: ArrayLike<number>;
  readonly mode: Mode;
  /** Positions at t = 0 (after the initial projection): the displacement reference. */
  readonly qRef: ArrayLike<number>;
  forces(): ProbeForces;
  /** Path length of a body from t = 0. */
  path(body: ModelBody): number;
}

function body(model: Model, id: string): ModelBody {
  const i = model.bodyIndex.get(id);
  if (i === undefined) throw new RangeError(`probe: unknown body "${id}"`);
  return model.bodies[i];
}

function axisVector(axis: Axis): { x: number; y: number } {
  if (axis === 'x') return { x: 1, y: 0 };
  if (axis === 'y') return { x: 0, y: 1 };
  const len = Math.hypot(axis.x, axis.y);
  return { x: axis.x / len, y: axis.y / len };
}

function bodiesOf(model: Model, id: string | undefined): readonly ModelBody[] {
  return id === undefined ? model.bodies : [body(model, id)];
}

function kinetic(model: Model, ids: string | undefined, v: ArrayLike<number>): number {
  let e = 0;
  for (const b of bodiesOf(model, ids)) e += 0.5 * b.mass * (v[b.dofX] ** 2 + v[b.dofY] ** 2);
  return e;
}

function potential(model: Model, ids: string | undefined, q: ArrayLike<number>): number {
  let e = 0;
  const g = model.gravity;
  for (const b of bodiesOf(model, ids)) e -= b.mass * (g.x * q[b.dofX] + g.y * q[b.dofY]);
  return e;
}

/** The probe's value in state `s`. Throws RangeError on an unknown reference. */
export function evalProbe(model: Model, probe: ProbeRef, s: ProbeState): number {
  switch (probe.kind) {
    case 'bodyPosition': {
      const b = body(model, probe.body);
      return s.q[probe.component === 'x' ? b.dofX : b.dofY];
    }
    case 'bodyDisplacement': {
      const b = body(model, probe.body);
      const dx = s.q[b.dofX] - s.qRef[b.dofX];
      const dy = s.q[b.dofY] - s.qRef[b.dofY];
      if (probe.axis === undefined) return Math.hypot(dx, dy);
      const u = axisVector(probe.axis);
      return u.x * dx + u.y * dy;
    }
    case 'bodyVelocity': {
      const b = body(model, probe.body);
      return s.v[probe.component === 'x' ? b.dofX : b.dofY];
    }
    case 'bodySpeed': {
      const b = body(model, probe.body);
      return Math.hypot(s.v[b.dofX], s.v[b.dofY]);
    }
    case 'bodyAcceleration': {
      const b = body(model, probe.body);
      return s.forces().a[probe.component === 'x' ? b.dofX : b.dofY];
    }
    case 'bodyPathLength':
      return s.path(body(model, probe.body));
    case 'kineticEnergy':
      return kinetic(model, probe.body, s.v);
    case 'potentialEnergy':
      return potential(model, probe.body, s.q);
    case 'totalEnergy':
      return kinetic(model, probe.body, s.v) + potential(model, probe.body, s.q);
    case 'stringTension':
      constraintOf(model, probe.string, 'string');
      return s.mode.active.includes(probe.string) ? s.forces().lambda(probe.string) : 0;
    case 'contactNormal':
      constraintOf(model, probe.contact, 'contact');
      return s.mode.active.includes(probe.contact) ? s.forces().lambda(probe.contact) : 0;
    case 'contactFriction':
      constraintOf(model, probe.contact, 'contact');
      return s.mode.active.includes(probe.contact) ? s.forces().friction(probe.contact) : 0;
    case 'contactRegime': {
      constraintOf(model, probe.contact, 'contact');
      const state = s.mode.friction[probe.contact];
      return state === undefined ? CONTACT_REGIME.inactive : CONTACT_REGIME[state];
    }
  }
}

/**
 * The probe's analytic time derivative, for max/min queries: positions and displacements along an
 * axis → velocities; velocities → accelerations. undefined: not supported (QUERY_UNSUPPORTED).
 */
export function evalProbeRate(model: Model, probe: ProbeRef, s: ProbeState): number | undefined {
  switch (probe.kind) {
    case 'bodyPosition':
      return evalProbe(model, { ...probe, kind: 'bodyVelocity' }, s);
    case 'bodyDisplacement': {
      if (probe.axis === undefined) return undefined;
      const b = body(model, probe.body);
      const u = axisVector(probe.axis);
      return u.x * s.v[b.dofX] + u.y * s.v[b.dofY];
    }
    case 'bodyVelocity':
      return evalProbe(model, { ...probe, kind: 'bodyAcceleration' }, s);
    default:
      return undefined;
  }
}

export function probeHasRate(probe: ProbeRef): boolean {
  return (
    probe.kind === 'bodyPosition' ||
    probe.kind === 'bodyVelocity' ||
    (probe.kind === 'bodyDisplacement' && probe.axis !== undefined)
  );
}

/** Characteristic size of a probe's values (for scale-relative bands), from the scene scales. */
export function probeScale(model: Model, probe: ProbeRef): number {
  const { length: L, velocity: V, force: F } = model.scales;
  switch (probe.kind) {
    case 'bodyPosition':
    case 'bodyDisplacement':
    case 'bodyPathLength':
      return L;
    case 'bodyVelocity':
    case 'bodySpeed':
      return V;
    case 'bodyAcceleration':
      return (V * V) / L;
    case 'kineticEnergy':
    case 'potentialEnergy':
    case 'totalEnergy':
      return F * L;
    case 'stringTension':
    case 'contactNormal':
    case 'contactFriction':
      return F;
    case 'contactRegime':
      return 1;
  }
}

/** Scale of the probe's rate (velocity for positions, acceleration for velocities). */
export function probeRateScale(model: Model, probe: ProbeRef): number {
  const { length: L, velocity: V } = model.scales;
  return probe.kind === 'bodyVelocity' ? (V * V) / L : V;
}

function constraintOf(model: Model, id: string, kind: 'string' | 'contact'): void {
  const i = model.constraintIndex.get(id);
  if (i === undefined || model.constraints[i].kind !== kind)
    throw new RangeError(`probe: unknown ${kind} "${id}"`);
}
