/**
 * ESLint flat config for BANTAYOG monorepo.
 * BE1 owns base config. Uses typescript-eslint for TypeScript file support.
 * Full rule set (no-throw in services/, import restrictions) added in P5.
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**', '**/*.config.ts', '**/public/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off', // TypeScript handles this
      '@typescript-eslint/no-explicit-any': 'off', // P1: allow any in pragmatic casts
    },
  },
)
