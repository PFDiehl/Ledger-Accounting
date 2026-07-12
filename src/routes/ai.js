import { Router } from 'express';
const router = Router({ mergeParams: true });
router.post('/chat', async (req, res) => { res.json({ success: true, data: { message: 'AI features coming soon.' } }); });
export default router;