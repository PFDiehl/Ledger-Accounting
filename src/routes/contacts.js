import { Router } from 'express';
import prisma from '../lib/prisma.js';
const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    const where = { orgId: req.params.orgId };
    if (type) where.type = type;
    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { invoices: { select: { total: true, status: true } } }
    });
    res.json({ success: true, data: contacts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/:contactId', async (req, res) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.contactId },
      include: { invoices: true }
    });
    res.json({ success: true, data: contact });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, city, state, zip, poNumber, salesperson, type } = req.body;
    const contact = await prisma.contact.create({
      data: { orgId: req.params.orgId, name, email, phone, address, city, state, zip, poNumber, salesperson, type: type||'customer' }
    });
    res.json({ success: true, data: contact });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/:contactId', async (req, res) => {
  try {
    const { name, email, phone, address, city, state, zip, poNumber, salesperson, type, isActive } = req.body;
    const contact = await prisma.contact.update({
      where: { id: req.params.contactId },
      data: { name, email, phone, address, city, state, zip, poNumber, salesperson, type, isActive }
    });
    res.json({ success: true, data: contact });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:contactId', async (req, res) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.contactId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;