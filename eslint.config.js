// Revisión automática del código: `npm run lint`.
// ESLint 10 entiende JSX: avisa de componentes usados sin importar y de importaciones sobrantes.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', 'dist/**', 'client/dist/**', 'data/**', 'logosfotos/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['server/**/*.js', 'api/**/*.js', 'client/api/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.config.js', 'client/*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['client/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
];
