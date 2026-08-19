// @ts-check

import { config } from '@douglasneuroinformatics/eslint-config';

const moduleBoundaryPatterns = [
  {
    group: ['@/prisma/generated/**'],
    message: 'The generated client belongs to the prisma module. Inject a model with @InjectModel instead.'
  },
  {
    group: ['@/testing/**'],
    message: 'src/testing is test-only.'
  },
  {
    group: ['@/*/adapters/*', '@/*/bridges/*'],
    message: 'Adapter internals belong to their module. Import from the module surface instead.'
  }
];

const prismaPattern = {
  group: ['@prisma/*', 'better-sqlite3'],
  message: 'Prisma lives behind the prisma module. Inject a model with @InjectModel instead.'
};

/** @type {(...patterns: Record<string, any>[]) => Record<string, any>} */
const restrictImports = (...patterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
  'no-restricted-imports': 'off'
});

export default config(
  {
    astro: {
      enabled: true
    },
    env: {
      browser: false,
      es2021: true,
      node: true
    },
    react: {
      enabled: true,
      version: 'detect'
    },
    typescript: {
      enabled: true
    }
  },
  {
    ignores: ['app/src/prisma/generated/**']
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off'
    }
  },
  {
    files: ['app/src/**/*.ts'],
    ignores: ['app/src/**/__tests__/**', 'app/src/testing/**'],
    rules: restrictImports(...moduleBoundaryPatterns, prismaPattern)
  },
  {
    files: ['app/src/prisma/**/*.ts'],
    ignores: ['app/src/**/__tests__/**'],
    rules: restrictImports(...moduleBoundaryPatterns)
  },
  {
    files: ['app/e2e/tests/**/*.ts'],
    rules: restrictImports(
      {
        group: ['@mattermost/*'],
        message: 'Mattermost lives behind the e2e harness. Drive the app through a Channel instead.'
      },
      {
        group: [
          '**/support/cluster.ts',
          '**/support/constants.ts',
          '**/support/collegium.ts',
          '**/support/utils/**',
          '**/support/workspace.ts'
        ],
        message: 'Tests use the harness surface, not its internals.'
      }
    )
  },
  {
    files: ['docs/src/**/*.{ts,tsx,astro}'],
    rules: {
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true
          }
        }
      ],
      // import/extensions cannot enforce this: it mistakes dotted basenames (content.source) for
      // extensions, and this repo's <name>.<kind>.ts convention makes those the likeliest misses.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              message: 'Include the file extension in internal imports.',
              regex: String.raw`^(@/|\.\.?/)(?!.*\.(astro|css|png|svg|ts|tsx)$)`
            }
          ]
        }
      ]
    }
  }
);
