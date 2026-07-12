import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const bills = await prisma.bill.findMany({ where: { orgId: req.params.orgId }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: bills });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { vendor, amount, dueDate, description } = req.body;
    const bill = await prisma.bill.create({ data: { orgId: req.params.orgId, vendor, amount: Number(amount), dueDate: dueDate ? new Date(dueDate) : new Date(), description } });
    res.json({ success: true, data: bill });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;