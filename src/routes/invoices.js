import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { orgId: req.params.orgId },
      include: { contact: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: invoices });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { clientName, clientEmail, description, quantity, price, dueDate } = req.body;
    let contact = await prisma.contact.findFirst({ where: { orgId: req.params.orgId, email: clientEmail } });
    if (!contact) {
      contact = await prisma.contact.create({ data: { orgId: req.params.orgId, name: clientName, email: clientEmail || '', type: 'customer' } });
    }
    const total = Number(quantity || 1) * Number(price || 0);
    const count = await prisma.invoice.count({ where: { orgId: req.params.orgId } });
    const invoice = await prisma.invoice.create({ data: { orgId: req.params.orgId, contactId: contact.id, invoiceNumber: 'INV-'+(1001+count), status: 'draft', issueDate: new Date(), dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30*864e5), subtotal: total, total, notes: description } });
    res.json({ success: true, data: { ...invoice, contact } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/:invoiceId', async (req, res) => {
  try {
    const { clientName, clientEmail, description, quantity, price, status } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (price) {
      const total = Number(quantity || 1) * Number(price || 0);
      updateData.subtotal = total;
      updateData.total = total;
    }
    if (description) updateData.notes = description;
    if (clientName || clientEmail) {
      let contact = await prisma.contact.findFirst({ where: { orgId: req.params.orgId, email: clientEmail } });
      if (!contact && clientName) {
        contact = await prisma.contact.create({ data: { orgId: req.params.orgId, name: clientName, email: clientEmail || '', type: 'customer' } });
      }
      if (contact?.id) updateData.contactId = contact.id;
    }
    const invoice = await prisma.invoice.update({ where: { id: req.params.invoiceId }, data: updateData });
    res.json({ success: true, data: invoice });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:invoiceId', async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.invoiceId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;