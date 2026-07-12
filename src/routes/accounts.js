import { Router } from 'express';
import prisma from '../lib/prisma.js';
const router = Router({ mergeParams: true });
router.get('/', async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({ where: { orgId: req.params.orgId }, orderBy: { code: 'asc' } });
    res.json({ success: true, data: accounts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
export default router;