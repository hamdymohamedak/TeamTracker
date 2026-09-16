/**
 * Unused duplicate of the AI routes module.
 * Canonical (authenticated + org-scoped) implementation:
 *   ./routes/ai-routes.ts
 *
 * Mounted by index.ts as: app.use('/api/ai', aiRoutes from './routes/ai-routes.js')
 * Do not mount this file — re-exports the secured router if imported by mistake.
 */
export { default } from './routes/ai-routes.js';
