#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';

const command = [
  '--filter',
  '@fa/web',
  'exec',
  'vitest',
  'run',
  'src/App.test.tsx',
  'src/auth/UserBootstrapGate.test.tsx',
  'src/services/userApi.test.ts',
  'src/workspace/WorkspaceApp.test.tsx',
  'src/admin/AdminShell.test.tsx',
  'src/admin/PendingRequestsPage.test.tsx',
  'src/admin/UsersPage.test.tsx',
  'src/admin/knowledge/KnowledgeAdminPage.test.tsx',
  'src/admin/usage/UsageDashboard.test.tsx',
  'src/workspace/useChatWorkflow.test.ts',
];

const result = spawnSync('pnpm', command, {
  cwd: new URL('../../', import.meta.url),
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
