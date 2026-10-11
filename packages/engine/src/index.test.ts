import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index';

describe('@mech/engine', () => {
  it('exports a semver ENGINE_VERSION', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
