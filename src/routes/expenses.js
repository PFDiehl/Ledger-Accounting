import { Router } from 'express';
import prisma from '../lib/prisma.js';
const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({ where: { orgId: req.params.orgId }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: expenses });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { vendor, category, amount, date, description, receiptNumber, paymentMethod } = req.body;
    const expense = await prisma.expense.create({
      data: {
        orgId: req.params.orgId,
        vendor,
        category: category||'Other',
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description,
        receiptNumber,
        paymentMethod
      }
    });
    res.json({ success: true, data: expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/:expenseId', async (req, res) => {
  try {
    const { vendor, category, amount, date, description, receiptNumber, paymentMethod } = req.body;
    const expense = await prisma.expense.update({
      where: { id: req.params.expenseId },
      data: {
        vendor,
        category: category||'Other',
        amount: Number(amount),
        date: date ? new Date(date) : undefined,
        description,
        receiptNumber,
        paymentMethod
      }
    });
    res.json({ success: true, data: expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:expenseId', async (req, res) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.expenseId } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/:expenseId/receipt', async (req, res) => {
  try {
    const { v2: cloudinary } = await import('cloudinary');
    cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: 'No image provided' });
    const dataUri = `data:${mediaType || 'image/jpeg'};base64,${imageBase64}`;
    const result = await cloudinary.uploader.upload(dataUri, { folder: 'ledger-receipts', public_id: `receipt-${req.params.expenseId}-${Date.now()}`, resource_type: 'image' });
    const expense = await prisma.expense.update({ where: { id: req.params.expenseId }, data: { receiptUrl: result.secure_url } });
    res.json({ success: true, receiptUrl: result.secure_url, expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:expenseId/receipt', async (req, res) => {
  try {
    const expense = await prisma.expense.update({ where: { id: req.params.expenseId }, data: { receiptUrl: null } });
    res.json({ success: true, expense });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

export default router;