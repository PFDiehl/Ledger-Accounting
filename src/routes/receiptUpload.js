import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router({ mergeParams: true });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload receipt image to an expense
router.post('/:expenseId/receipt', async (req, res) => {
  try {
    const { expenseId } = req.params;
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: 'No image provided' });

    const dataUri = `data:${mediaType || 'image/jpeg'};base64,${imageBase64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'ledger-receipts',
      public_id: `receipt-${expenseId}-${Date.now()}`,
      resource_type: 'image',
    });

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: { receiptUrl: result.secure_url },
    });

    res.json({ success: true, receiptUrl: result.secure_url, expense });
  } catch (e) {
    console.error('Receipt upload error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Remove receipt from an expense
router.delete('/:expenseId/receipt', async (req, res) => {
  try {
    const { expenseId } = req.params;
    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: { receiptUrl: null },
    });
    res.json({ success: true, expense });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;