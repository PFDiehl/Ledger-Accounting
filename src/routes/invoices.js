router.delete('/:invoiceId', async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.invoiceId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/:invoiceId/send', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.invoiceId }, include: { contact: true, org: true } });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!invoice.contact?.email) return res.status(400).json({ success: false, message: 'No client email on file' });
    await sendInvoiceEmail({
      to: invoice.contact.email,
      clientName: invoice.contact.name,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      description: invoice.notes,
      orgName: invoice.org?.name || 'Mountain Top Ledger'
    });
    await prisma.invoice.update({ where: { id: req.params.invoiceId }, data: { status: 'sent' } });
    res.json({ success: true, message: 'Invoice sent!' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;
