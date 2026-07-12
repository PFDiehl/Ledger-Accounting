import { Router } from 'express';
import prisma from '../lib/prisma.js';
const router = Router({ mergeParams: true });
router.get('/', async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({ where: { orgId: req.params.orgId }, orderBy: { name: 'asc' } });
    res.json({ success: true, data: contacts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
router.post('/', async (req, res) => {
  try {
    const { name, email, type } = req.body;
    const contact = await prisma.contact.create({ data: { orgId: req.params.orgId, name, email, type: type||'customer' } });
    res.json({ success: true, data: contact });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
export default router;