import templEslintConfig from '@templ-project/eslint';

export default [
  {
    ignores: [
      '**/*.config.cjs',
      '**/*.config.js',
      '**/*.config.mjs',
      '*.html',
      '*.md',
      '.agents/skills/grill-me/**',
      '.agents/skills/grilling/**',
      '.agents/skills/unslop/**',
      '.eslintignore',
      '.gitignore',
      '.jscpd/**',
      '.prettierignore',
      'coverage/**',
      'dist/**',
      'docs/.vitepress/cache/**',
      'docs/.vitepress/dist/**',
      'jsconfig.json',
      'LICENSE',
      'node_modules/**',
      'package-lock.json',
      'pnpm-lock.yaml',
      'package.json',
      'packages/sdlc/vendor/**',
      'tsconfig*.json',
    ],
  },
  ...templEslintConfig,
];
