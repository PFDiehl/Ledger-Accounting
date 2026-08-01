import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInvoiceEmail({ to, clientName, invoiceNumber, total, subtotal, taxAmount, shipping, discount, lines, notes, orgName }) {
  const lineRows = (lines || []).map(l => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;">${l.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;text-align:center;">${Number(l.quantity)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;text-align:right;">$${Number(l.unitPrice).toFixed(2)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333;font-size:14px;text-align:right;">$${Number(l.amount).toFixed(2)}</td>
    </tr>
  `).join('');

  return resend.emails.send({
    from: 'Mountain Top Ledger <notifications@mail.mountaintopledger.com>',
    to,
    subject: `Invoice ${invoiceNumber} from ${orgName}`,
    html: `
      <div style="font-family:sans-serif;max-width:650px;margin:0 auto;padding:32px;background:#f9f9f9;">
        <div style="background:#1a3a1a;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#ffd166;margin:0;font-size:28px;">${orgName}</h1>
          <p style="color:#a8d4a8;margin:8px 0 0;font-size:14px;">Built for where you are going</p>
        </div>
        <div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
            <div>
              <p style="color:#333;font-size:16px;margin:0;">Dear ${clientName},</p>
              <p style="color:#666;font-size:14px;">Please find your invoice details below.</p>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;color:#7A9A7A;">Invoice Number</div>
              <div style="font-size:18px;font-weight:700;color:#1a3a1a;">${invoiceNumber}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#7A9A7A;font-weight:600;">DESCRIPTION</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#7A9A7A;font-weight:600;">QTY</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#7A9A7A;font-weight:600;">RATE</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#7A9A7A;font-weight:600;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
          <div style="border-top:1px solid #f0f0f0;padding-top:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="color:#666;font-size:14px;">Subtotal</span>
              <span style="color:#333;font-size:14px;">$${Number(subtotal||0).toFixed(2)}</span>
            </div>
            ${Number(taxAmount||0) > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;font-size:14px;">Tax</span><span style="color:#333;font-size:14px;">$${Number(taxAmount).toFixed(2)}</span></div>` : ''}
            ${Number(shipping||0) > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;font-size:14px;">Shipping</span><span style="color:#333;font-size:14px;">$${Number(shipping).toFixed(2)}</span></div>` : ''}
            ${Number(discount||0) > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;font-size:14px;">Discount</span><span style="color:#c0392b;font-size:14px;">-$${Number(discount).toFixed(2)}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;padding-top:12px;border-top:2px solid #1a3a1a;margin-top:8px;">
              <span style="color:#1a3a1a;font-size:16px;font-weight:700;">Amount Due</span>
              <span style="color:#1a3a1a;font-size:20px;font-weight:700;">$${Number(total||0).toFixed(2)}</span>
            </div>
          </div>
          ${notes ? `<div style="margin-top:20px;padding:12px;background:#f9f9f9;border-radius:8px;"><p style="color:#666;font-size:13px;margin:0;">${notes}</p></div>` : ''}
          <p style="color:#666;font-size:14px;margin-top:20px;">Please remit payment at your earliest convenience. Thank you for your business!</p>
        </div>
        <div style="text-align:center;padding:16px;">
          <p style="color:#999;font-size:12px;">Sent via Mountain Top Ledger · mountaintopledger.com</p>
        </div>
      </div>
    `
  });
}