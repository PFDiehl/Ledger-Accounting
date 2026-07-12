import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/rates', async (req, res) => { res.json({ success: true, data: [] }); });
export default router;