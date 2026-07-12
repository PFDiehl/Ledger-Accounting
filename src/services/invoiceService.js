import prisma from '../lib/prisma.js';
import { AppError, NotFoundError } from '../lib/errors.js';

// Calculate line item amounts and invoice totals
export function calcInvoiceTotals(lineItems) {
  const lines = lineItems.map((item) => {
    const amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
    const taxAmt = Math.round(amount * (item.taxRate / 100) * 100) / 100;
    return { ...item, amount, taxAmount: taxAmt };
  });

  const subtotal  = lines.reduce((s, l) => s + l.amount, 0);
  const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0);
  const total     = Math.round((subtotal + taxAmount) * 100) / 100;

  return { lines, subtotal, taxAmount, total };
}

// Get next invoice number atomically
async function nextInvoiceNumber(orgId, tx) {
  const seq = await tx.sequence.update({
    where:  { orgId_name: { orgId, name: 'invoice' } },
    data:   { nextVal: { increment: 1 } },
    select: { prefix: true, nextVal: true },
  });
  return `${seq.prefix}${seq.nextVal - 1}`;
}

// Create an invoice with line items inside a transaction
export async function createInvoice(orgId, userId, data) {
  const { lineItems, ...invoiceData } = data;
  const { lines, subtotal, taxAmount, total } = calcInvoiceTotals(lineItems);

  return prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(orgId, tx);

    const invoice = await tx.invoice.create({
      data: {
        orgId,
        invoiceNumber,
        subtotal,
        taxAmount,
        total,
        createdById: userId,
        ...invoiceData,
        lineItems: {
          createMany: {
            data: lines.map(({ taxAmount: _ta, ...l }, i) => ({
              ...l,
              sortOrder: i,
            })),
          },
        },
      },
      include: { lineItems: true, contact: true },
    });

    return invoice;
  });
}

// Mark invoice as sent and post a journal entry (DR: Accounts Receivable, CR: Revenue)
export async function sendInvoice(orgId, userId, invoiceId) {
  const invoice = await prisma.invoice.findFirst({
    where:   { id: invoiceId, orgId },
    include: { lineItems: true },
  });

  if (!invoice)                    throw new NotFoundError('Invoice');
  if (invoice.status !== 'draft')  throw new AppError('Only draft invoices can be sent', 422);

  // Find system accounts
  const [arAccount, revenueAccount] = await Promise.all([
    prisma.account.findFirst({ where: { orgId, subtype: 'accounts_receivable', isSystem: true } }),
    prisma.account.findFirst({ where: { orgId, subtype: 'operating_revenue',   isSystem: true } }),
  ]);

  if (!arAccount || !revenueAccount) {
    throw new AppError('Chart of accounts not set up correctly', 500);
  }

  return prisma.$transaction(async (tx) => {
    // Get next journal entry number
    const jeSeq = await tx.sequence.update({
      where:  { orgId_name: { orgId, name: 'journal' } },
      data:   { nextVal: { increment: 1 } },
      select: { prefix: true, nextVal: true },
    });
    const entryNumber = `${jeSeq.prefix}${String(jeSeq.nextVal - 1).padStart(4, '0')}`;

    // Create journal entry: DR Accounts Receivable / CR Revenue
    const journalEntry = await tx.journalEntry.create({
      data: {
        orgId,
        entryNumber,
        date:        invoice.issueDate,
        description: `Invoice ${invoice.invoiceNumber} — ${invoice.contactId}`,
        source:      'invoice',
        sourceId:    invoice.id,
        status:      'posted',
        createdById: userId,
        postedAt:    new Date(),
        lines: {
          createMany: {
            data: [
              { accountId: arAccount.id,      debit: invoice.total,  credit: 0 },
              { accountId: revenueAccount.id, debit: 0,              credit: invoice.total },
            ],
          },
        },
      },
    });

    // Update invoice status
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data:  {
        status:         'sent',
        sentAt:         new Date(),
        journalEntryId: journalEntry.id,
      },
      include: { lineItems: true, contact: true },
    });

    return updated;
  });
}

// Record a payment against an invoice
export async function recordInvoicePayment(orgId, userId, invoiceId, amount, method, paymentDate) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, orgId },
  });

  if (!invoice) throw new NotFoundError('Invoice');
  if (!['sent', 'partial', 'overdue'].includes(invoice.status)) {
    throw new AppError('Invoice cannot be paid in its current status', 422);
  }
  if (amount > Number(invoice.amountDue ?? invoice.total)) {
    throw new AppError('Payment exceeds amount due', 422);
  }

  return prisma.$transaction(async (tx) => {
    const newAmountPaid = Number(invoice.amountPaid) + amount;
    const isPaid        = newAmountPaid >= Number(invoice.total);

    const [updatedInvoice] = await Promise.all([
      tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: newAmountPaid,
          status:     isPaid ? 'paid' : 'partial',
          paidAt:     isPaid ? new Date() : null,
        },
      }),
      tx.payment.create({
        data: {
          orgId,
          type:        'incoming',
          contactId:   invoice.contactId,
          amount,
          currency:    invoice.currency,
          paymentDate: new Date(paymentDate),
          method,
          createdById: userId,
          allocations: {
            create: { invoiceId, amount },
          },
        },
      }),
    ]);

    return updatedInvoice;
  });
}
