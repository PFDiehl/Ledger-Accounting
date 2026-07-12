import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/dashboard', async (req, res) => { res.json({ success: true, data: { revenue: 0, expenses: 0, netProfit: 0, cashBalance: 0 } }); });
router.get('/pl', async (req, res) => { res.json({ success: true, data: [] }); });
router.get('/balance-sheet', async (req, res) => { res.json({ success: true, data: [] }); });
export default router;