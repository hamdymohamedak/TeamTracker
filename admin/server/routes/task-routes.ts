import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllTasks,
  getTasksByProject,
  createTask,
  updateTask,
} from '../database.js';
import { requireAuth } from '../auth.js';

export function setupTaskRoutes(app: Express): void {
  app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
      let tasks;
      if (req.query.projectId) {
        tasks = await getTasksByProject(req.orgId!, req.query.projectId as string);
      } else {
        tasks = await getAllTasks(req.orgId!);
      }
      res.json({ success: true, data: tasks });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const task = {
        id: uuidv4(),
        ...req.body,
        orgId: req.orgId!,
        status: req.body.status || 'todo',
        priority: req.body.priority || 'medium',
        createdAt: now,
        updatedAt: now
      };
      await createTask(task);
      res.json({ success: true, data: task });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      await updateTask(req.orgId!, req.params.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const { deleteTask } = await import('../database.js');
      await deleteTask(req.orgId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
