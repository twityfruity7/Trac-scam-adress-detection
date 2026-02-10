import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      // This UI is a thin control plane over JSON-ish RPC payloads and event streams.
      // Using `any` for untrusted network data is intentional; runtime validation happens server-side.
      '@typescript-eslint/no-explicit-any': 'off',
      // Common pattern: catch (_e) {} for best-effort UI/telemetry paths.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // TanStack Virtual returns functions that trip the compiler memoization heuristic; safe to ignore here.
      'react-hooks/incompatible-library': 'off',
      // Internal field components intentionally sync display state from props.
      'react-hooks/set-state-in-effect': 'off',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
