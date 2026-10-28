import globals from 'globals'
import pluginReactConfig from 'eslint-plugin-react/configs/recommended.js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from '@typescript-eslint/eslint-plugin'
import pluginJs from '@eslint/js'

export default [
  { ignores: ['node_modules', 'public', 'build', 'dist'] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  pluginReactConfig,
  eslintConfigPrettier
]
