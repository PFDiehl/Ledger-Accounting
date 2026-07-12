// Proactive insights service
// Runs nightly (via cron) and generates plain-English insights for each org.
// Insights are stored in the DB and surfaced in the daily digest and push notifications.

import prisma from '../lib/prisma.js';

// ── Insight generators ────────────────────────────────────────────────────────

async function checkOverdueInvoices(orgId) {
  const overdue = await prisma.invoice.findMany({
    where:   { orgId, status: 'overdue' },
    include: { contact: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });

  if (!overdue.length) return null;

  const total    = overdue.reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0);
  const oldest   = overdue[0];
  const daysLate = Math.floor((Date.now() - new Date(oldest.dueDate)) / 864e5);

  return {
    type:     'overdue_invoices',
    severity: daysLate > 60 ? 'high' : daysLate > 30 ? 'medium' : 'low',
    title:    overdue.length === 1
      ? `${oldest.contact.name} owes you money and is ${daysLate} days late`
      : `${overdue.length} clients are late paying — ${formatCurrency(total)} outstanding`,
    detail:   `The oldest is ${oldest.contact.name} at ${daysLate} days overdue. ${
      daysLate > 60
        ? 'At this point, a phone call works better than email.'
        : daysLate > 30
        ? 'A firm reminder email is appropriate now.'
        : 'A gentle nudge should do the trick.'
    }`,
    action:   'Send reminders',
    data:     { count: overdue.length, total, oldestDaysLate: daysLate },
  };
}

async function checkCashPosition(orgId) {
  const banks    = await prisma.bankAccount.findMany({ where: { orgId } });
  const balance  = banks.reduce((s, b) => s + Number(b.currentBalance ?? 0), 0);

  const thirtyDays = new Date(Date.now() + 30 * 864e5);
  const [bills, invoices] = await Promise.all([
    prisma.bill.aggregate({
      where:   { orgId, status: { in: ['pending','overdue'] }, dueDate: { lte: thirtyDays } },
      _sum:    { total: true },
    }),
    prisma.invoice.aggregate({
      where:   { orgId, status: { in: ['sent','partial','overdue'] }, dueDate: { lte: thirtyDays } },
      _sum:    { total: true },
    }),
  ]);

  const outgoing = Number(bills._sum.total ?? 0);
  const incoming = Number(invoices._sum.total ?? 0);
  const projected = balance + incoming - outgoing;

  if (projected < 0) return {
    type:     'cash_crunch',
    severity: 'high',
    title:    `Cash may run short in the next 30 days`,
    detail:   `You have ${formatCurrency(balance)} now, ${formatCurrency(incoming)} expected in, and ${formatCurrency(outgoing)} in bills due. That leaves a projected ${formatCurrency(projected)} — below zero.`,
    action:   'See cash forecast',
    data:     { balance, incoming, outgoing, projected },
  };

  if (projected < balance * 0.3) return {
    type:     'cash_low_warning',
    severity: 'medium',
    title:    `Your cash cushion is thinner than usual`,
    detail:   `After expected bills and payments in the next 30 days, you'll have about ${formatCurrency(projected)}. That's ${Math.round((projected / balance) * 100)}% of your current balance.`,
    action:   'Review cash forecast',
    data:     { balance, projected },
  };

  return null;
}

async function checkExpenseSpike(orgId) {
  const now       = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);

  const [thisMonth, lastMonth] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { account: { orgId, type:'expense' }, entry: { orgId, status:'posted', date:{ gte: thisMonthStart } } },
      _sum: { debit: true },
    }),
    prisma.journalLine.aggregate({
      where: { account: { orgId, type:'expense' }, entry: { orgId, status:'posted', date:{ gte: lastMonthStart, lte: lastMonthEnd } } },
      _sum: { debit: true },
    }),
  ]);

  const current  = Number(thisMonth._sum.debit ?? 0);
  const previous = Number(lastMonth._sum.debit ?? 0);

  if (!previous || current < 100) return null;

  // Annualise current month
  const daysInMonth = now.getDate();
  const projected   = (current / daysInMonth) * 30;
  const changePct   = Math.round(((projected - previous) / previous) * 100);

  if (changePct > 25) return {
    type:     'expense_spike',
    severity: 'medium',
    title:    `Expenses are running ${changePct}% higher than last month`,
    detail:   `At your current pace, you'll spend ${formatCurrency(projected)} this month vs ${formatCurrency(previous)} last month. Worth checking if there's anything unexpected in there.`,
    action:   'Review expenses',
    data:     { current, previous, projected, changePct },
  };

  return null;
}

async function checkUnreviewedTransactions(orgId) {
  const count = await prisma.bankTransaction.count({
    where: { orgId, status: 'unreviewed' },
  });
  if (count < 5) return null;

  return {
    type:     'unreviewed_transactions',
    severity: 'low',
    title:    `${count} bank transactions haven't been reviewed`,
    detail:   `These transactions have been imported from your bank but not matched to your accounts yet. Takes about ${Math.ceil(count / 5)} minutes to review.`,
    action:   'Review now',
    data:     { count },
  };
}

async function checkPayrollDue(orgId) {
  const nextWeek = new Date(Date.now() + 5 * 864e5);
  const run = await prisma.payRun.findFirst({
    where:   { orgId, status: { in: ['draft','approved'] }, payDate: { lte: nextWeek } },
    orderBy: { payDate: 'asc' },
  });
  if (!run) return null;

  const daysUntil = Math.ceil((new Date(run.payDate) - Date.now()) / 864e5);
  const employeeCount = await prisma.payStub.count({ where: { payRunId: run.id } });

  return {
    type:     'payroll_due',
    severity: daysUntil <= 1 ? 'high' : 'medium',
    title:    `Payroll is due ${daysUntil <= 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`}`,
    detail:   `${employeeCount > 0 ? `${employeeCount} employees` : 'Pay run'} · ${
      run.status === 'draft'
        ? 'Needs to be calculated and approved before submitting.'
        : 'Approved and ready to submit for direct deposit.'
    }`,
    action:   run.status === 'draft' ? 'Calculate payroll' : 'Submit direct deposit',
    data:     { payRunId: run.id, daysUntil, status: run.status, employeeCount },
  };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function generateInsightsForOrg(orgId) {
  const generators = [
    checkOverdueInvoices,
    checkCashPosition,
    checkExpenseSpike,
    checkUnreviewedTransactions,
    checkPayrollDue,
  ];

  const insights = (await Promise.allSettled(
    generators.map(fn => fn(orgId))
  ))
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  // Store in DB, replacing today's insights for this org
  const today = new Date(); today.setHours(0,0,0,0);

  await prisma.orgInsight.deleteMany({ where: { orgId, generatedAt: { gte: today } } });

  if (insights.length) {
    await prisma.orgInsight.createMany({
      data: insights.map(insight => ({
        orgId,
        type:        insight.type,
        severity:    insight.severity,
        title:       insight.title,
        detail:      insight.detail,
        action:      insight.action,
        data:        insight.data ?? {},
        generatedAt: new Date(),
      })),
    });
  }

  return insights;
}

export async function generateInsightsForAllOrgs() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let total = 0;
  for (const org of orgs) {
    const insights = await generateInsightsForOrg(org.id).catch(() => []);
    total += insights.length;
  }
  console.log(`[insights] Generated insights for ${orgs.length} orgs (${total} total)`);
  return total;
}

// ── GET /orgs/:orgId/digest — summary for the daily digest page ───────────────

export async function getDigestForOrg(orgId) {
  const today  = new Date(); today.setHours(0,0,0,0);

  const [insights, banks, overdueAR, upcomingBills, upcomingAR] = await Promise.all([
    prisma.orgInsight.findMany({
      where:   { orgId, generatedAt: { gte: today } },
      orderBy: [{ severity: 'asc' }, { generatedAt: 'desc' }],
    }),
    prisma.bankAccount.findMany({ where: { orgId }, select: { currentBalance: true } }),
    prisma.invoice.findMany({
      where:   { orgId, status: 'overdue' },
      select:  { id:true, total:true, amountPaid:true, dueDate:true, contact: { select: { name:true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.bill.findMany({
      where:   { orgId, status:{ in:['pending','overdue'] }, dueDate:{ lte: new Date(Date.now() + 30*864e5) } },
      select:  { id:true, total:true, dueDate:true, contact: { select: { name:true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.invoice.findMany({
      where:   { orgId, status:{ in:['sent','partial'] }, dueDate:{ lte: new Date(Date.now() + 30*864e5) } },
      select:  { id:true, total:true, amountPaid:true, dueDate:true, contact: { select: { name:true } } },
      orderBy: { dueDate: 'asc' },
    }),
  ]);

  const cashBalance = banks.reduce((s, b) => s + Number(b.currentBalance ?? 0), 0);

  return {
    cashBalance,
    insights: insights.map(i => ({
      id:       i.id,
      type:     i.type,
      severity: i.severity,
      title:    i.title,
      detail:   i.detail,
      action:   i.action,
      data:     i.data,
    })),
    overdueAR: overdueAR.map(inv => ({
      id:      inv.id,
      client:  inv.contact?.name,
      amount:  Number(inv.total) - Number(inv.amountPaid),
      dueDate: inv.dueDate,
      daysLate:Math.floor((Date.now() - new Date(inv.dueDate)) / 864e5),
    })),
    upcomingBills: upcomingBills.map(b => ({
      id:       b.id,
      vendor:   b.contact?.name,
      amount:   Number(b.total),
      dueDate:  b.dueDate,
      daysUntil:Math.ceil((new Date(b.dueDate) - Date.now()) / 864e5),
    })),
    upcomingAR: upcomingAR.map(inv => ({
      id:       inv.id,
      client:   inv.contact?.name,
      amount:   Number(inv.total) - Number(inv.amountPaid),
      dueDate:  inv.dueDate,
      daysUntil:Math.ceil((new Date(inv.dueDate) - Date.now()) / 864e5),
    })),
  };
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(n);
}
