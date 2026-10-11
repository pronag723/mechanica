/**
 * Loading the engine-level scenes (tests/scenes/engine/*.json) and the oracle's expected values.
 * The JSON is typed by its envelope only; ModelSpec validation is compileModel's job.
 */
import expectedJson from '../../../../tests/scenes/expected.json';
import { compileModel } from '../../src/model/compile';
import type { Model } from '../../src/model/types';
import type { ModelSpec } from '../../src/spec';

export interface SceneFile {
  readonly id: string;
  readonly description: string;
  readonly spec: ModelSpec;
  readonly variants?: Readonly<Record<string, Partial<ModelSpec>>>;
}

export function loadScene(json: unknown): SceneFile {
  if (typeof json !== 'object' || json === null) throw new Error('scene: not an object');
  const { id, spec } = json as { id?: unknown; spec?: unknown };
  if (typeof id !== 'string' || typeof spec !== 'object' || spec === null)
    throw new Error('scene: missing id or spec');
  return json as SceneFile;
}

/** The scene's spec with a variant's top-level fields applied. */
export function variantSpec(scene: SceneFile, variant: string): ModelSpec {
  const patch = scene.variants?.[variant];
  if (!patch) throw new Error(`scene ${scene.id}: no variant "${variant}"`);
  return { ...scene.spec, ...patch };
}

/** Compiles and fails loudly on any diagnostic error. */
export function compileOrThrow(spec: ModelSpec): Model {
  const { model, diagnostics } = compileModel(spec);
  if (!model) throw new Error(`compile failed: ${JSON.stringify(diagnostics, null, 2)}`);
  return model;
}

interface ExpectedQuantity {
  readonly value: number;
  readonly class: string;
  readonly note: string;
}
const expected = expectedJson as Record<string, Record<string, ExpectedQuantity>>;

export function expectedValue(sceneId: string, key: string): number {
  const q = expected[sceneId]?.[key];
  if (!q) throw new Error(`expected.json has no ${sceneId}.${key}`);
  return q.value;
}

/** Relative error |actual − expected|/|expected|; the absolute error when expected = 0. */
export function relErr(actual: number, expectedValue: number): number {
  const scale = Math.abs(expectedValue);
  return scale > 0 ? Math.abs(actual - expectedValue) / scale : Math.abs(actual);
}
