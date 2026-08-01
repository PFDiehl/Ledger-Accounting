import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { sendInvoiceEmail } from '../lib/email.js';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { orgId: req.params.orgId },
      include: { contact: true, lines: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: invoices });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/:invoiceId', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { contact: true, lines: true, org: true }
    });
    res.json({ success: true, data: invoice });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { clientName, clientEmail, poNumber, notes, taxRate, shipping, discount, dueDate, lines } = req.body;
    let contact = await prisma.contact.findFirst({ where: { orgId: req.params.orgId, email: clientEmail } });
    if (!contact) {
      contact = await prisma.contact.create({ data: { orgId: req.params.orgId, name: clientName, email: clientEmail || '', type: 'customer' } });
    } else if (clientName && contact.name !== clientName) {
      contact = await prisma.contact.update({ where: { id: contact.id }, data: { name: clientName } });
    }
    const lineItems = lines || [];
    const subtotal = lineItems.reduce((s, l) => s + (Number(l.quantity) * Number(l.unitPrice)), 0);
    const taxAmount = subtotal * (Number(taxRate || 0) / 100);
    const total = subtotal + taxAmount + Number(shipping || 0) - Number(discount || 0);
    const count = await prisma.invoice.count({ where: { orgId: req.params.orgId } });
    const invoice = await prisma.invoice.create({
      data: {
        orgId: req.params.orgId,
        contactId: contact.id,
        invoiceNumber: 'INV-' + (1001 + count),
        status: 'draft',
        issueDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 864e5),
        subtotal,
        taxAmount,
        taxRate: Number(taxRate || 0),
        shipping: Number(shipping || 0),
        discount: Number(discount || 0),
        total,
        notes,
        poNumber,
        lines: {
          create: lineItems.map(l => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            amount: Number(l.quantity) * Number(l.unitPrice)
          }))
        }
      },
      include: { contact: true, lines: true }
    });
    res.json({ success: true, data: invoice });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/:invoiceId', async (req, res) => {
  try {
    const { clientName, clientEmail, poNumber, notes, taxRate, shipping, discount, dueDate, lines, status } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (poNumber !== undefined) updateData.poNumber = poNumber;
    if (dueDate) updateData.dueDate = new Date(dueDate);
    if (lines) {
      const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) * Number(l.unitPrice)), 0);
      const taxAmount = subtotal * (Number(taxRate || 0) / 100);
      const total = subtotal + taxAmount + Number(shipping || 0) - Number(discount || 0);
      updateData.subtotal = subtotal;
      updateData.taxAmount = taxAmount;
      updateData.taxRate = Number(taxRate || 0);
      updateData.shipping = Number(shipping || 0);
      updateData.discount = Number(discount || 0);
      updateData.total = total;
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: req.params.invoiceId } });
      updateData.lines = {
        create: lines.map(l => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          amount: Number(l.quantity) * Number(l.unitPrice)
        }))
      };
    }
    if (clientName || clientEmail) {
      let contact = await prisma.contact.findFirst({ where: { orgId: req.params.orgId, email: clientEmail } });
      if (!contact && clientName) {
        contact = await prisma.contact.create({ data: { orgId: req.params.orgId, name: clientName, email: clientEmail || '', type: 'customer' } });
      }
      if (contact?.id) updateData.contactId = contact.id;
    }
    const invoice = await prisma.invoice.update({
      where: { id: req.params.invoiceId },
      data: updateData,
      include: { contact: true, lines: true }
    });
    res.json({ success: true, data: invoice });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:invoiceId', async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.invoiceId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/:invoiceId/send', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { contact: true, org: true, lines: true }
    });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!invoice.contact?.email) return res.status(400).json({ success: false, message: 'No client email on file' });
    await sendInvoiceEmail({
      to: invoice.contact.email,
      clientName: invoice.contact.name,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      shipping: invoice.shipping,
      discount: invoice.discount,
      lines: invoice.lines,
      notes: invoice.notes,
      orgName: (invoice.org?.name === 'Ledger' ? 'Mountain Top Ledger' : invoice.org?.name) || 'Mountain Top Ledger'
    });
    await prisma.invoice.update({ where: { id: req.params.invoiceId }, data: { status: 'sent' } });
    res.json({ success: true, message: 'Invoice sent!' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;
