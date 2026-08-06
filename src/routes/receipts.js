import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
const router = Router({ mergeParams: true });

router.post('/scan', async (req, res) => {
  try {
    console.log('ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: 'No image provided' });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Extract receipt info. Return ONLY valid JSON with these fields: vendor (string), amount (number, the final total), date (YYYY-MM-DD format), category (one of: Advertising & Marketing, Bank Charges, Equipment, Insurance, Legal & Professional Fees, Meals & Entertainment, Office Supplies, Payroll, Rent & Lease, Software & Subscriptions, Taxes & Licenses, Travel, Utilities, Vehicle, Other). No explanation, just JSON.' }
        ]
      }]
    });
    const text = message.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    res.json({ success: true, data });
  } catch(e) {
    console.error('Receipt scan error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;