import { Router } from 'express';
const router = Router({ mergeParams: true });
router.get('/', async (req, res) => { res.json({ success: true, data: { cashBalance: 0, insights: [], overdueAR: [], upcomingBills: [], upcomingAR: [] } }); });
export default router;