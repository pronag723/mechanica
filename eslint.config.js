import comments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DETERMINISM =
  'The engine is deterministic (CLAUDE.md, physics rule 6): no clocks and no randomness. ' +
  'Benchmarks in *.test.ts files may opt out with an eslint-disable comment.';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.vite/',
    '**/playwright-report/',
    '**/test-results/',
    '.venv/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Node scripts and config files outside the packages.
  {
    files: ['**/*.{js,mjs,cjs}', '*.ts', 'tools/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Type-aware rules for the workspace packages.
  {
    files: ['packages/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  // Determinism inside the engine: no Math.random, Date or performance.now.
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      // Every use of the Date and performance globals (Date.now, new Date, performance.now).
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: DETERMINISM },
        { name: 'performance', message: DETERMINISM },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: DETERMINISM },
        { object: 'globalThis', property: 'Date', message: DETERMINISM },
        { object: 'globalThis', property: 'performance', message: DETERMINISM },
      ],
    },
  },
  // ...and the opt-out comment is only honoured in test files.
  {
    files: ['packages/engine/**/*.ts'],
    ignores: ['packages/engine/**/*.test.ts'],
    plugins: { '@eslint-community/eslint-comments': comments },
    rules: {
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'no-restricted-globals',
        'no-restricted-properties',
      ],
    },
  },

  prettier,
);
