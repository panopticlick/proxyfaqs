import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginAstro from 'eslint-plugin-astro';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.astro'],
    ...pluginAstro.configs.recommended,
  },
  {
    ignores: ['dist', 'node_modules', '.astro', 'public', 'build', '*.config.*'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
];
