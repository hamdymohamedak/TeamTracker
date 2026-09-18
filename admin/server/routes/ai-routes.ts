import { Router } from 'express';
import { getEmployeeById } from '../database.js';
import { detectRepetitivePatterns, getTopAgentOpportunities } from '../ai-analytics.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import type { ChatRequest } from './ai/types.js';
import { processNaturalLanguageQuery } from './ai/process-query.js';

const router: import('express').Router = Router();

// All AI routes require dashboard auth (sets req.orgId)
router.use(requireAuth);
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: 'ai',
    keyFn: (req) => req.orgId || req.ip || 'unknown',
    message: 'AI rate limit exceeded. Please wait a moment.',
  })
);

/**
 * Natural language query endpoint for AI chat
 */
router.post('/chat', async (req, res) => {
  try {
    const { question }: ChatRequest = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const orgId = req.orgId!;
    if (!orgId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const response = await processNaturalLanguageQuery(question, orgId);
    res.json(response);
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      answer:
        'Sorry, I encountered an error processing your question. Please try again.',
    });
  }
});

/**
 * Get repetitive patterns and automation opportunities
 */
router.get('/patterns', async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (!orgId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { employeeId, days } = req.query;
    let scopedEmployeeId = employeeId as string | undefined;
    if (scopedEmployeeId) {
      const emp = await getEmployeeById(orgId, scopedEmployeeId);
      if (!emp) {
        return res.status(404).json({ error: 'Employee not found' });
      }
    }
    const patterns = await detectRepetitivePatterns(
      scopedEmployeeId,
      days ? parseInt(days as string) : 7,
      orgId,
    );
    res.json(patterns);
  } catch (error) {
    console.error('Pattern detection error:', error);
    res.status(500).json({ error: 'Failed to detect patterns' });
  }
});

/**
 * Get top agent opportunities
 */
router.get('/opportunities', async (req, res) => {
  try {
    const orgId = req.orgId!;
    if (!orgId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { limit } = req.query;
    const opportunities = await getTopAgentOpportunities(
      limit ? parseInt(limit as string) : 5,
      orgId,
    );
    res.json(opportunities);
  } catch (error) {
    console.error('Opportunities error:', error);
    res.status(500).json({ error: 'Failed to get opportunities' });
  }
});

export default router as import('express').Router;
