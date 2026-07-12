import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/subscription', async (req, res) => { res.json({ success: true, data: null }); });
export default router;