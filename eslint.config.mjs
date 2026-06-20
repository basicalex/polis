// ESLint flat config for the Polis Interface TS workspace.
// Covers .ts/.mjs/.js source. Astro files are checked via `astro check`
// (typecheck) and excluded here; Rego is checked via `opa check` (policy-rules).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      '**/.vite/**',
      '**/*.d.ts',
      '**/*.astro',
      'The Iceberg Index/**',
      '.aoc/**',
      '.omp/**',
      '.pi/**',
      '.taskmaster/**',
      'packages/db/migrations/**',
      'apps/**/.astro/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      // leading-underscore marks intentionally-unused args/vars/catch bindings
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // wire shapes legitimately carry untyped boundaries at the edges
      '@typescript-eslint/no-explicit-any': 'off',
      // enforce `import type` for type-only imports (matches verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
