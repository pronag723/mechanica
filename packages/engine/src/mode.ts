/**
 * Modes (DESIGN §3.4): which unilateral constraints are active, and for each active contact
 * whether it sticks or slips. Plain serializable data, kept sorted.
 *
 * Friction states of an active contact (t = the face tangent, v_t = t·v_body):
 * - `stick`: v_t = 0 is enforced by an extra row J_t·a = −J̇_t·v with multiplier λ_t, the signed
 *   static friction force along +t.
 * - `slipPos`: the body slides along +t (v_t > 0); kinetic friction μk·N acts along −t.
 * - `slipNeg`: the body slides along −t (v_t < 0); kinetic friction μk·N acts along +t.
 */
import { compareIds } from './ids';
import type { Model } from './model/types';

export type FrictionState = 'stick' | 'slipPos' | 'slipNeg';

export interface Mode {
  /** Ids of the active constraints, sorted. */
  readonly active: readonly string[];
  /** A state for every active contact (and only for those), keyed by contact id. */
  readonly friction: Readonly<Record<string, FrictionState>>;
}

/** The slip sign s of a friction state: +1 slipPos, −1 slipNeg, 0 stick. */
export function slipSign(state: FrictionState): -1 | 0 | 1 {
  return state === 'slipPos' ? 1 : state === 'slipNeg' ? -1 : 0;
}

/** A copy with sorted `active` and `friction` keys in sorted order (canonical form). */
export function normalizeMode(mode: Mode): Mode {
  const active = [...mode.active].sort(compareIds);
  const friction = Object.fromEntries(
    Object.keys(mode.friction)
      .sort(compareIds)
      .map((id) => [id, mode.friction[id]]),
  ) as Record<string, FrictionState>;
  return { active, friction };
}

/** A canonical string for a mode, for sets and logs: `id[,id…]|contact=state[,…]`. */
export function modeKey(mode: Mode): string {
  const m = normalizeMode(mode);
  return `${m.active.join(',')}|${Object.entries(m.friction)
    .map(([id, s]) => `${id}=${s}`)
    .join(',')}`;
}

/**
 * Checks a mode against a model; throws RangeError on misuse (an engine bug, not a scene problem):
 * unknown or repeated ids, a friction state on a string or an inactive contact, or an active
 * contact without one.
 */
export function assertValidMode(model: Model, mode: Mode): void {
  const seen = new Set<string>();
  for (const id of mode.active) {
    if (!model.constraintIndex.has(id)) throw new RangeError(`mode: unknown constraint "${id}"`);
    if (seen.has(id)) throw new RangeError(`mode: constraint "${id}" is listed twice`);
    seen.add(id);
    const c = model.constraints[model.constraintIndex.get(id) ?? -1];
    if (c.kind === 'contact' && !Object.hasOwn(mode.friction, id))
      throw new RangeError(`mode: active contact "${id}" has no friction state`);
  }
  for (const [id, state] of Object.entries(mode.friction)) {
    if (!seen.has(id)) throw new RangeError(`mode: friction state for inactive "${id}"`);
    const c = model.constraints[model.constraintIndex.get(id) ?? -1];
    if (c.kind !== 'contact') throw new RangeError(`mode: "${id}" is not a contact`);
    if (state !== 'stick' && state !== 'slipPos' && state !== 'slipNeg')
      throw new RangeError(`mode: unknown friction state "${String(state)}" for "${id}"`);
  }
}
