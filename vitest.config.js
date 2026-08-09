// @ts-check

import * as path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  plugins: [swc.vite()],
  resolve: {
    conditions: ['source', 'module', 'browser', 'development|production']
  },
  root: import.meta.dirname,
  ssr: {
    resolve: {
      conditions: ['source', 'module', 'node', 'development|production']
    }
  },
  test: {
    coverage: {
      exclude: [
        '**/.coverage/**',
        '**/dist/**',
        '**/scripts/**',
        '**/*.d.?(c|m)ts',
        '**/*{.,-}{test,test-d,spec}.?(c|m)[jt]s?(x)',
        '**/*.config.?(c|m)[jt]s?(x)',
        'app/src/app.module.ts',
        'app/src/bootstrap.ts'
      ],
      provider: 'v8',
      reportsDirectory: path.resolve(import.meta.dirname, '.coverage'),
      skipFull: true,
      thresholds: {
        100: true
      }
    },
    projects: [
      {
        extends: true,
        test: {
          include: ['app/src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          name: 'unit',
          typecheck: {
            enabled: true,
            include: ['app/src/**/*.test-d.ts'],
            tsconfig: path.resolve(import.meta.dirname, 'app/tsconfig.json')
          }
        }
      },
      {
        extends: true,
        test: {
          include: ['packages/*/src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          name: 'packages',
          typecheck: {
            enabled: true,
            include: ['packages/*/src/**/*.test-d.ts'],
            tsconfig: path.resolve(import.meta.dirname, 'packages/core/tsconfig.json')
          }
        }
      },
      {
        extends: true,
        test: {
          include: ['plugins/*/src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          name: 'plugins'
        }
      },
      {
        extends: true,
        test: {
          fileParallelism: false,
          globalSetup: ['app/e2e/setup/cluster.setup.ts'],
          hookTimeout: 600_000,
          include: ['app/e2e/**/*.e2e.test.ts'],
          name: 'e2e',
          testTimeout: 20_000
        }
      }
    ],
    watch: false
  }
});
