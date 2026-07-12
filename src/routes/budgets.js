import { Router } from 'express';
import prisma from '../lib/prisma.js';
const router = Router({ mergeParams: true });
router.get('/', async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({ where: { orgId: req.params.orgId }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: budgets });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
router.post('/', async (req, res) => {
  try {
    const { name, amount, period, category } = req.body;
    const budget = await prisma.budget.create({ data: { orgId: req.params.orgId, name, amount: Number(amount), period: period||'monthly', category: category||'General' } });
    res.json({ success: true, data: budget });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
export default router;