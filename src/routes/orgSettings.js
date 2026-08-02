import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
    res.json({ success: true, data: org });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/', async (req, res) => {
  try {
    const { name, email, phone, address, city, state, zip, country, taxId, website, currency, invoiceNotes, paymentTerms, invoicePrefix } = req.body;
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: {
        name: name || undefined,
        email: email || undefined,
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
        ...(country !== undefined && { country }),
        ...(taxId !== undefined && { taxId }),
        ...(website !== undefined && { website }),
        ...(currency !== undefined && { currency }),
        ...(invoiceNotes !== undefined && { invoiceNotes }),
        ...(paymentTerms !== undefined && { paymentTerms }),
        ...(invoicePrefix !== undefined && { invoicePrefix }),
      }
    });
    res.json({ success: true, data: org });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;