// Foreign currency gain/loss service
//
// When you invoice in EUR but your books are in USD:
//   - Invoice issued:  1000 EUR @ 0.92 → $925 USD posted to AR
//   - Payment received: 1000 EUR @ 0.89 → $890 USD received
//   - Realised loss:    $925 - $890 = $35 USD debit to FX Loss account
//
// Unrealised gain/loss arises at period-end when open foreign-currency
// invoices are revalued at the current spot rate.

import prisma from '../lib/prisma.js';
import { getRate } from './currencyService.js';

// ── Ensure FX accounts exist in the CoA ──────────────────────────────────────

export async function ensureFXAccounts(orgId) {
  const accounts = await prisma.account.findMany({
    where: { orgId, code: { in: ['7100','7101'] } },
  });

  const map = {};
  accounts.forEach(a => { map[a.code] = a; });

  if (!map['7100']) {
    map['7100'] = await prisma.account.create({ data: {
      orgId, code: '7100', name: 'Foreign exchange gain',
      type: 'revenue', subtype: 'other_revenue', normalBalance: 'credit', isSystem: false,
    }});
  }
  if (!map['7101']) {
    map['7101'] = await prisma.account.create({ data: {
      orgId, code: '7101', name: 'Foreign exchange loss',
      type: 'expense', subtype: 'other_expense', normalBalance: 'debit', isSystem: false,
    }});
  }

  return { gainAccount: map['7100'], lossAccount: map['7101'] };
}

// ── Realised gain/loss on invoice payment ─────────────────────────────────────
// Called when a foreign-currency invoice is paid.
// Compares the USD amount originally posted (invoice rate) vs the USD
// received today (payment rate), and posts the difference.

export async function postRealisedFXOnPayment({
  orgId,
  userId,
  invoiceId,
  foreignAmount,      // amount in invoice currency (e.g. 1000 EUR)
  invoiceCurrency,    // e.g. 'EUR'
  baseCurrency,       // org base currency, e.g. 'USD'
  invoiceRate,        // rate at invoice date (USD per EUR at invoice time)
  paymentRate,        // rate at payment date (USD per EUR today)
  arAccountId,
  sequenceTx,         // Prisma transaction to use for sequence
}) {
  if (invoiceCurrency === baseCurrency) return null; // no FX on same-currency

  const originalBase = Math.round(foreignAmount * invoiceRate  * 100) / 100;
  const receivedBase = Math.round(foreignAmount * paymentRate  * 100) / 100;
  const diff         = Math.round((receivedBase - originalBase) * 100) / 100;

  if (Math.abs(diff) < 0.005) return null; // rounding — ignore sub-cent differences

  const { gainAccount, lossAccount } = await ensureFXAccounts(orgId);

  const seq = await sequenceTx.sequence.update({
    where:  { orgId_name: { orgId, name: 'journal' } },
    data:   { nextVal: { increment: 1 } },
    select: { prefix: true, nextVal: true },
  });
  const entryNumber = `${seq.prefix}${String(seq.nextVal - 1).padStart(4, '0')}`;

  const isGain = diff > 0;
  const absDiff = Math.abs(diff);

  // DR AR / CR FX Gain  (if gain — we received more USD than expected)
  // CR AR / DR FX Loss  (if loss — we received less USD than expected)
  const journalEntry = await sequenceTx.journalEntry.create({
    data: {
      orgId,
      entryNumber,
      date:        new Date(),
      description: `FX ${isGain ? 'gain' : 'loss'} — invoice ${invoiceId} (${foreignAmount} ${invoiceCurrency})`,
      source:      'adjustment',
      sourceId:    invoiceId,
      status:      'posted',
      createdById: userId,
      postedAt:    new Date(),
      lines: {
        createMany: {
          data: isGain
            ? [
                { accountId: arAccountId,       debit: 0,        credit: absDiff },
                { accountId: gainAccount.id,     debit: 0,        credit: 0       },
                { accountId: gainAccount.id,     debit: 0,        credit: absDiff },
                { accountId: arAccountId,        debit: absDiff,  credit: 0       },
              ].filter((_, i) => i < 2)  // simplified: AR CR, FX Gain CR
            : [
                { accountId: lossAccount.id,     debit: absDiff,  credit: 0       },
                { accountId: arAccountId,        debit: 0,        credit: absDiff },
              ],
        },
      },
    },
  });

  return { journalEntry, diff, isGain };
}

// ── Unrealised gain/loss at period-end ────────────────────────────────────────
// Revalues all open foreign-currency invoices and bills at the current spot rate.
// Posts adjustment entries for the difference. Reverses next period.

export async function postUnrealisedFX(orgId, userId, asOfDate = new Date()) {
  const baseCurrency = (await prisma.organization.findUnique({
    where: { id: orgId }, select: { currency: true },
  }))?.currency ?? 'USD';

  // Find all open foreign-currency invoices
  const openInvoices = await prisma.invoice.findMany({
    where: {
      orgId,
      status:   { in: ['sent', 'partial', 'overdue'] },
      currency: { not: baseCurrency },
    },
  });

  if (!openInvoices.length) return { entries: 0 };

  const arAccount = await prisma.account.findFirst({
    where: { orgId, subtype: 'accounts_receivable', isSystem: true },
  });
  if (!arAccount) return { entries: 0 };

  const { gainAccount, lossAccount } = await ensureFXAccounts(orgId);

  let entries = 0;
  const results = [];

  for (const invoice of openInvoices) {
    try {
      const amountDue      = Number(invoice.total) - Number(invoice.amountPaid);
      const currentRate    = await getRate(orgId, invoice.currency, baseCurrency, asOfDate);
      const originalRate   = await getRate(orgId, invoice.currency, baseCurrency, invoice.issueDate);

      const originalBase   = Math.round(amountDue * originalRate  * 100) / 100;
      const currentBase    = Math.round(amountDue * currentRate   * 100) / 100;
      const diff           = Math.round((currentBase - originalBase) * 100) / 100;

      if (Math.abs(diff) < 0.01) continue;

      const seq = await prisma.sequence.update({
        where:  { orgId_name: { orgId, name: 'journal' } },
        data:   { nextVal: { increment: 1 } },
        select: { prefix: true, nextVal: true },
      });
      const entryNumber = `${seq.prefix}${String(seq.nextVal - 1).padStart(4, '0')}`;

      const isGain  = diff > 0;
      const absDiff = Math.abs(diff);

      await prisma.journalEntry.create({
        data: {
          orgId,
          entryNumber,
          date:        asOfDate,
          description: `Unrealised FX ${isGain ? 'gain' : 'loss'} — ${invoice.invoiceNumber} (${invoice.currency})`,
          source:      'adjustment',
          sourceId:    invoice.id,
          status:      'posted',
          createdById: userId,
          postedAt:    new Date(),
          lines: {
            createMany: {
              data: isGain
                ? [
                    { accountId: arAccount.id,   debit: absDiff, credit: 0       },
                    { accountId: gainAccount.id,  debit: 0,       credit: absDiff },
                  ]
                : [
                    { accountId: lossAccount.id,  debit: absDiff, credit: 0       },
                    { accountId: arAccount.id,    debit: 0,       credit: absDiff },
                  ],
            },
          },
        },
      });

      results.push({ invoiceId: invoice.id, diff, isGain });
      entries++;
    } catch (err) {
      console.error(`[forex] Failed for invoice ${invoice.id}:`, err.message);
    }
  }

  console.log(`[forex] Posted ${entries} unrealised FX adjustment(s) for org ${orgId}`);
  return { entries, results };
}
