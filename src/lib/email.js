import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInvoiceEmail({ to, clientName, invoiceNumber, total, description, orgName }) {
  return resend.emails.send({
    from: 'Mountain Top Ledger <onboarding@resend.dev>',
    to,
    subject: `Invoice ${invoiceNumber} from ${orgName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9f9f9;">
        <div style="background:#1a3a1a;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#ffd166;margin:0;font-size:28px;">Mountain Top Ledger</h1>
          <p style="color:#a8d4a8;margin:8px 0 0;font-size:14px;">Built for where you are going</p>
        </div>
        <div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px;">
          <p style="color:#333;font-size:16px;">Dear ${clientName},</p>
          <p style="color:#333;font-size:16px;">Please find your invoice details below:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr style="background:#f5f5f5;">
              <td style="padding:12px;font-weight:600;color:#333;">Invoice Number</td>
              <td style="padding:12px;color:#333;">${invoiceNumber}</td>
            </tr>
            <tr>
              <td style="padding:12px;font-weight:600;color:#333;">Description</td>
              <td style="padding:12px;color:#333;">${description || 'Professional Services'}</td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:12px;font-weight:600;color:#333;">Amount Due</td>
              <td style="padding:12px;color:#1a3a1a;font-weight:700;font-size:18px;">$${Number(total).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
            </tr>
          </table>
          <p style="color:#666;font-size:14px;">Please remit payment at your earliest convenience.</p>
        </div>
        <div style="text-align:center;padding:16px;">
          <p style="color:#999;font-size:12px;">Sent via Mountain Top Ledger · mountaintopledger.com</p>
        </div>
      </div>
    `
  });
}