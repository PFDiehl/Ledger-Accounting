import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({ where: { orgId: req.params.orgId }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: expenses });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { vendor, category, amount, date, description } = req.body;
    const expense = await prisma.expense.create({ data: { orgId: req.params.orgId, vendor, category: category||'Other', amount: Number(amount), date: date ? new Date(date) : new Date(), description } });
    res.json({ success: true, data: expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/:expenseId', async (req, res) => {
  try {
    const { vendor, category, amount, description } = req.body;
    const expense = await prisma.expense.update({ where: { id: req.params.expenseId }, data: { vendor, category: category||'Other', amount: Number(amount), description } });
    res.json({ success: true, data: expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:expenseId', async (req, res) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.expenseId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});export default router;