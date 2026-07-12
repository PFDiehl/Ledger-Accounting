import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/employees', async (req, res) => { res.json({ success: true, data: [] }); });
router.get('/pay-runs', async (req, res) => { res.json({ success: true, data: [] }); });
export default router;