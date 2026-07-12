import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/', async (req, res) => { res.json({ success: true, data: [] }); });
export default router;