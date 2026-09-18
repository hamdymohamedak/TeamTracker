import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
} from '../database.js';
import { requireAuth } from '../auth.js';

export function setupProjectRoutes(app: Express): void {
  app.get('/api/projects', requireAuth, async (req, res) => {
    try {
      const projects = await getAllProjects(req.orgId!);
      res.json({ success: true, data: projects });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const project = await getProjectById(req.orgId!, req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/projects', requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const project = {
        id: uuidv4(),
        ...req.body,
        orgId: req.orgId!,
        status: req.body.status || 'active',
        startDate: req.body.startDate || now,
        createdAt: now,
        updatedAt: now
      };
      await createProject(project);
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      await updateProject(req.orgId!, req.params.id, req.body);
      const project = await getProjectById(req.orgId!, req.params.id);
      res.json({ success: true, data: project });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Hard-delete a project. Also deletes any tasks under it so we don't
  // leave orphans. Org-scoped via req.orgId.
  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const project = await getProjectById(req.orgId!, req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }
      const { deleteProject } = await import('../database.js');
      await deleteProject(req.orgId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
