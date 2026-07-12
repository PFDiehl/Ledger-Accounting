import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/logs', async (req, res) => { res.json({ success: true, data: [] }); });
export default router;