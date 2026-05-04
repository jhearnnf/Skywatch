import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Ban bare "fixed inset-0" in className strings outside the Overlay primitive.
    // Use <Overlay> instead; it handles safe-area padding and portaling automatically.
    // App.jsx is excluded: its loading fallback renders before the portal target is ready.
    files: ['**/*.{js,jsx}'],
    ignores: ['src/components/ui/Overlay.jsx', 'src/App.jsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="className"][value.type="Literal"][value.value=/fixed inset-0/]',
          message: 'Use <Overlay> from src/components/ui/Overlay.jsx instead of bare "fixed inset-0" className.',
        },
        {
          selector: 'JSXAttribute[name.name="className"][value.type="TemplateLiteral"] > TemplateElement[value.cooked=/fixed inset-0/]',
          message: 'Use <Overlay> from src/components/ui/Overlay.jsx instead of bare "fixed inset-0" in template literal className.',
        },
      ],
    },
  },
])
