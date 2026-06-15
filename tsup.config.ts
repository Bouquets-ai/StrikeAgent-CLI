import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.tsx',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // 这些原生/可选依赖保持外部化，运行时从 node_modules 解析
  external: ['@vscode/ripgrep'],
})
