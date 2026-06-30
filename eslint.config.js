import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const isFetchCall = (callee) => {
  if (callee.type === 'Identifier') {
    return callee.name === 'fetch';
  }

  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const object = callee.object;
  const property = callee.property;
  const isFetchProperty =
    (property.type === 'Identifier' && property.name === 'fetch') ||
    (property.type === 'Literal' && property.value === 'fetch');

  if (!isFetchProperty || object.type !== 'Identifier') {
    return false;
  }

  return object.name === 'window' || object.name === 'globalThis';
};

const localRules = {
  'no-raw-web-fetch': {
    meta: {
      type: 'problem',
      docs: {
        description: 'Keep browser fetch calls behind the web API client.',
      },
      schema: [],
      messages: {
        rawFetch: 'Use apps/web/src/services/apiClient.ts for browser API calls.',
      },
    },
    create(context) {
      const filename = context.filename.replaceAll('\\', '/');
      const isWebSource = filename.includes('/apps/web/src/');
      const isApiClient = filename.endsWith('/apps/web/src/services/apiClient.ts');

      if (!isWebSource || isApiClient) {
        return {};
      }

      return {
        CallExpression(node) {
          if (isFetchCall(node.callee)) {
            context.report({ node, messageId: 'rawFetch' });
          }
        },
      };
    },
  },
};

const tsFiles = ['**/*.{ts,tsx}'];
const sourceFiles = ['**/*.{js,mjs,cjs,ts,tsx}'];
const typeCheckedTsConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({
  ...config,
  files: tsFiles,
}));

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.worktrees/**', 'docs/**'],
  },
  eslint.configs.recommended,
  ...typeCheckedTsConfigs,
  {
    files: sourceFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      local: {
        rules: localRules,
      },
    },
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'local/no-raw-web-fetch': 'error',
    },
  }
);
