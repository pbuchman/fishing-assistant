import type { FastifyInstance } from 'fastify';

import { registerAdminUsageRoutes } from './adminUsageRoutes.js';
import { registerInternalUsageRoutes } from './internalUsageRoutes.js';

export function registerUsageRoutes(app: FastifyInstance): void {
  registerInternalUsageRoutes(app);
  registerAdminUsageRoutes(app);
}
