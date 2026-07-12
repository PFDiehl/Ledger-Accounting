import nodemailer from 'nodemailer';

// ── Transport factory ─────────────────────────────────────────────────────────

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NODE_ENV } = process.env;

  // In development with no SMTP config, use Ethereal (catches email locally)
  if (NODE_ENV !== 'production' && !SMTP_HOST) {
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: SMTP_USER ?? 'ethereal-dev', pass: SMTP_PASS ?? 'ethereal-dev' },
    });
  }

  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT) === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    pool:   true,
    maxConnections: 5,
  });
}

let transport = null;
function getTransport() {
  if (!transport) transport = createTransport();
  return transport;
}

const FROM = process.env.EMAIL_FROM ?? 'Ledger <noreply@example.com>';

// ── Email templates ───────────────────────────────────────────────────────────

function invoiceEmailHtml({ orgName, clientName, invoiceNumber, dueDate, total, portalUrl }) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, Arial, sans-serif; font-size: 14px; color: #1a1a18; background: #f8f8f6; margin: 0; padding: 32px 16px; }
  .card { background: #fff; border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 36px 40px; border: 1px solid #eee; }
  .logo  { font-size: 18px; font-weight: 700; color: #534AB7; margin-bottom: 28px; }
  h2     { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  p      { color: #555; line-height: 1.6; margin-bottom: 16px; }
  .meta  { background: #f8f8f6; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
  .meta-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
  .meta-key { color: #888; }
  .meta-val { font-weight: 600; color: #111; }
  .btn   { display: inline-block; background: #534AB7; color: #fff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 8px 0 20px; }
  .footer { font-size: 11px; color: #aaa; text-align: center; margin-top: 28px; }
</style></head>
<body>
  <div class="card">
    <div class="logo">${orgName}</div>
    <h2>You have a new invoice</h2>
    <p>Hi ${clientName},</p>
    <p>${orgName} has sent you invoice ${invoiceNumber}. Please review the details below and submit your payment by the due date.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-key">Invoice #</span><span class="meta-val">${invoiceNumber}</span></div>
      <div class="meta-row"><span class="meta-key">Due date</span><span class="meta-val">${dueDate}</span></div>
      <div class="meta-row"><span class="meta-key">Amount due</span><span class="meta-val">${total}</span></div>
    </div>
    <a href="${portalUrl}" class="btn">View &amp; pay invoice →</a>
    <p style="font-size:12px;color:#aaa">A PDF copy of the invoice is attached to this email.</p>
    <div class="footer">Sent via Ledger · If you have questions, reply to this email.</div>
  </div>
</body></html>`;
}

function overdueReminderHtml({ orgName, clientName, invoiceNumber, daysOverdue, total, portalUrl }) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, Arial, sans-serif; font-size: 14px; color: #1a1a18; background: #f8f8f6; margin: 0; padding: 32px 16px; }
  .card { background: #fff; border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 36px 40px; border: 1px solid #eee; }
  .logo  { font-size: 18px; font-weight: 700; color: #534AB7; margin-bottom: 28px; }
  .badge { display: inline-block; background: #FCEBEB; color: #A32D2D; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; }
  h2     { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  p      { color: #555; line-height: 1.6; margin-bottom: 16px; }
  .meta  { background: #f8f8f6; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
  .meta-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
  .meta-key { color: #888; }
  .meta-val { font-weight: 600; color: #111; }
  .btn   { display: inline-block; background: #A32D2D; color: #fff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 8px 0 20px; }
  .footer { font-size: 11px; color: #aaa; text-align: center; margin-top: 28px; }
</style></head>
<body>
  <div class="card">
    <div class="logo">${orgName}</div>
    <div class="badge">Payment overdue — ${daysOverdue} days</div>
    <h2>Payment reminder</h2>
    <p>Hi ${clientName},</p>
    <p>This is a reminder that invoice ${invoiceNumber} from ${orgName} is now <strong>${daysOverdue} days overdue</strong>. Please arrange payment at your earliest convenience.</p>
    <div class="meta">
      <div class="meta-row"><span class="meta-key">Invoice #</span><span class="meta-val">${invoiceNumber}</span></div>
      <div class="meta-row"><span class="meta-key">Days overdue</span><span class="meta-val" style="color:#A32D2D">${daysOverdue}</span></div>
      <div class="meta-row"><span class="meta-key">Amount due</span><span class="meta-val">${total}</span></div>
    </div>
    <a href="${portalUrl}" class="btn">Pay now →</a>
    <div class="footer">Sent via Ledger · If you believe this is an error, please reply to this email.</div>
  </div>
</body></html>`;
}

// ── Public functions ──────────────────────────────────────────────────────────

export async function sendInvoiceEmail({ invoice, org, pdfBuffer }) {
  const { contact } = invoice;
  if (!contact?.email) throw new Error('Contact has no email address');

  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const total   = new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency ?? 'USD' }).format(Number(invoice.total));
  const portalUrl = `${process.env.FRONTEND_URL}/invoices/${invoice.id}`;

  const info = await getTransport().sendMail({
    from:    FROM,
    to:      `${contact.name} <${contact.email}>`,
    subject: `Invoice ${invoice.invoiceNumber} from ${org.name} — ${total} due ${dueDate}`,
    html:    invoiceEmailHtml({ orgName: org.name, clientName: contact.name, invoiceNumber: invoice.invoiceNumber, dueDate, total, portalUrl }),
    attachments: pdfBuffer ? [{
      filename:    `${invoice.invoiceNumber}.pdf`,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  });

  // In development Ethereal captures the email; log the preview URL
  if (process.env.NODE_ENV !== 'production') {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log(`[email] Preview: ${previewUrl}`);
  }

  return info.messageId;
}

export async function sendOverdueReminder({ invoice, org }) {
  const { contact } = invoice;
  if (!contact?.email) throw new Error('Contact has no email address');

  const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate)) / 864e5);
  const total       = new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency ?? 'USD' }).format(Number(invoice.total) - Number(invoice.amountPaid ?? 0));
  const portalUrl   = `${process.env.FRONTEND_URL}/invoices/${invoice.id}`;

  const info = await getTransport().sendMail({
    from:    FROM,
    to:      `${contact.name} <${contact.email}>`,
    subject: `Reminder: Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue`,
    html:    overdueReminderHtml({ orgName: org.name, clientName: contact.name, invoiceNumber: invoice.invoiceNumber, daysOverdue, total, portalUrl }),
  });

  if (process.env.NODE_ENV !== 'production') {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log(`[email] Reminder preview: ${previewUrl}`);
  }

  return info.messageId;
}

export async function verifySmtpConnection() {
  try {
    await getTransport().verify();
    return true;
  } catch (err) {
    console.error('[email] SMTP connection failed:', err.message);
    return false;
  }
}
