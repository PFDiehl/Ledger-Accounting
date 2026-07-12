// Advanced payroll service
// W-2s, 1099s, state tax filings, ACH direct deposit

import prisma from '../lib/prisma.js';
import { calculatePayStub, calcGrossPay, calcEmployerTaxes } from './taxEngine.js';

// ── W-2 generation ────────────────────────────────────────────────────────────
// IRS Form W-2: Wage and Tax Statement
// Filed for every employee who earned ≥$600 or had taxes withheld

export async function generateW2s(orgId, taxYear) {
  const yearStart = new Date(`${taxYear}-01-01`);
  const yearEnd   = new Date(`${taxYear}-12-31`);

  const org = await prisma.organization.findUnique({
    where:  { id: orgId },
    select: { name: true, ein: true, address: true, city: true, state: true, zip: true },
  });

  const employees = await prisma.employee.findMany({
    where: { orgId, hireDate: { lte: yearEnd } },
  });

  const w2s = [];

  for (const emp of employees) {
    // Sum all processed pay stubs for the year
    const stubs = await prisma.payStub.findMany({
      where: {
        employeeId: emp.id,
        payRun: {
          orgId,
          status:  'processed',
          payDate: { gte: yearStart, lte: yearEnd },
        },
      },
    });

    if (!stubs.length) continue;

    const ytdGross    = stubs.reduce((s, st) => s + Number(st.grossPay),     0);
    const ytdFederal  = stubs.reduce((s, st) => s + Number(st.federalTax),   0);
    const ytdState    = stubs.reduce((s, st) => s + Number(st.stateTax),     0);
    const ytdSS       = stubs.reduce((s, st) => s + Number(st.socialSecurity), 0);
    const ytdMedicare = stubs.reduce((s, st) => s + Number(st.medicare),     0);

    if (ytdGross < 600 && ytdFederal === 0) continue; // IRS threshold

    w2s.push({
      taxYear,
      employeeId: emp.id,

      // Employer info (boxes a-e)
      employerEIN:     org.ein ?? '',
      employerName:    org.name,
      employerAddress: `${org.address ?? ''}, ${org.city ?? ''}, ${org.state ?? ''} ${org.zip ?? ''}`,

      // Employee info
      employeeSSN:     emp.ssn ? `***-**-${emp.ssn.slice(-4)}` : '', // masked
      employeeName:    `${emp.lastName}, ${emp.firstName}`,
      employeeAddress: emp.address ?? '',

      // Income and tax boxes
      box1_wages:          Math.round(ytdGross   * 100) / 100,  // Federal wages
      box2_federalTax:     Math.round(ytdFederal * 100) / 100,  // Federal income tax withheld
      box3_sswages:        Math.min(ytdGross, 176100),           // SS wages (wage base cap)
      box4_ssTax:          Math.round(ytdSS      * 100) / 100,  // SS tax withheld
      box5_medicareWages:  Math.round(ytdGross   * 100) / 100,  // Medicare wages (no cap)
      box6_medicareTax:    Math.round(ytdMedicare * 100) / 100, // Medicare tax withheld
      box15_stateEIN:      org.state ?? '',
      box16_stateWages:    Math.round(ytdGross   * 100) / 100,
      box17_stateTax:      Math.round(ytdState   * 100) / 100,
    });
  }

  // Persist W-2 records
  if (w2s.length) {
    await prisma.w2Form.createMany({
      data:            w2s.map(w => ({ ...w, orgId, status: 'draft' })),
      skipDuplicates:  true,
    });
  }

  return w2s;
}

// ── 1099-NEC generation ───────────────────────────────────────────────────────
// Required for contractors paid ≥$600 in a calendar year

export async function generate1099s(orgId, taxYear) {
  const yearStart = new Date(`${taxYear}-01-01`);
  const yearEnd   = new Date(`${taxYear}-12-31`);

  const org = await prisma.organization.findUnique({
    where:  { id: orgId },
    select: { name: true, ein: true },
  });

  // Get contractors (contacts marked as 1099 workers)
  const contractors = await prisma.contact.findMany({
    where: { orgId, is1099: true, isActive: true },
  });

  const forms = [];

  for (const contractor of contractors) {
    // Sum all bills paid to this contractor in the tax year
    const paid = await prisma.bill.aggregate({
      where: {
        orgId,
        contactId: contractor.id,
        status:    'paid',
        billDate:  { gte: yearStart, lte: yearEnd },
      },
      _sum: { total: true },
    });

    const amount = Number(paid._sum.total ?? 0);
    if (amount < 600) continue; // IRS $600 threshold

    forms.push({
      taxYear,
      contractorId:    contractor.id,
      orgId,
      employerEIN:     org.ein ?? '',
      employerName:    org.name,
      contractorName:  contractor.name,
      contractorTIN:   contractor.taxId ? `***-**-${contractor.taxId.slice(-4)}` : '',
      contractorAddress: contractor.address ?? '',
      box1_nonemployeeComp: Math.round(amount * 100) / 100,
      status: 'draft',
    });
  }

  if (forms.length) {
    await prisma.form1099.createMany({ data: forms, skipDuplicates: true });
  }

  return forms;
}

// ── State tax filing summary ──────────────────────────────────────────────────

export async function generateStateFilingSummary(orgId, taxYear, quarter) {
  // Quarter: 1=Jan-Mar, 2=Apr-Jun, 3=Jul-Sep, 4=Oct-Dec
  const qStart = new Date(`${taxYear}-${String((quarter-1)*3+1).padStart(2,'0')}-01`);
  const qEnd   = new Date(qStart);
  qEnd.setMonth(qEnd.getMonth() + 3);
  qEnd.setDate(qEnd.getDate() - 1);

  const stubs = await prisma.payStub.findMany({
    where: {
      payRun: { orgId, status: 'processed', payDate: { gte: qStart, lte: qEnd } },
    },
    include: {
      employee: { select: { firstName: true, lastName: true, stateCode: true } },
    },
  });

  // Aggregate by state
  const byState = {};
  stubs.forEach(stub => {
    const state = stub.employee.stateCode ?? 'XX';
    if (!byState[state]) byState[state] = { wages: 0, stateTax: 0, employees: new Set() };
    byState[state].wages    += Number(stub.grossPay);
    byState[state].stateTax += Number(stub.stateTax);
    byState[state].employees.add(stub.employeeId);
  });

  return {
    orgId, taxYear, quarter,
    period:   `${qStart.toISOString().slice(0,10)} to ${qEnd.toISOString().slice(0,10)}`,
    byState:  Object.entries(byState).map(([state, data]) => ({
      state,
      wages:       Math.round(data.wages    * 100) / 100,
      stateTax:    Math.round(data.stateTax * 100) / 100,
      employeeCount: data.employees.size,
    })),
    totalWages:  stubs.reduce((s, st) => s + Number(st.grossPay),  0),
    totalTaxes:  stubs.reduce((s, st) => s + Number(st.stateTax),  0),
    payRunCount: new Set(stubs.map(st => st.payRunId)).size,
  };
}

// ── ACH direct deposit batch ──────────────────────────────────────────────────
// Generates an ACH NACHA file for bank transmission

export function generateNACHAFile(payRun, stubs, companyInfo) {
  const now       = new Date();
  const fileDate  = now.toISOString().slice(2,10).replace(/-/g,'');  // YYMMDD
  const fileTime  = now.toTimeString().slice(0,5).replace(':','');   // HHMM
  const effDate   = new Date(payRun.payDate).toISOString().slice(2,10).replace(/-/g,'');

  const lines = [];

  // File Header Record (type 1)
  lines.push(
    '1' +
    '01' +                                           // priority code
    padRight(companyInfo.routingNumber, 10) +        // immediate destination
    padRight(companyInfo.ein.replace('-',''), 10) +  // immediate origin
    fileDate +
    fileTime +
    'A' +                                            // file ID modifier
    '094' +                                          // record size
    '10' +                                           // blocking factor
    '1' +                                            // format code
    padRight(companyInfo.bankName, 23) +
    padRight(companyInfo.name, 23) +
    '        '                                       // reference code
  );

  // Batch Header (type 5)
  lines.push(
    '5' +
    '200' +                                          // service class (debits & credits)
    padRight(companyInfo.name, 16) +
    '          ' +                                   // discretionary data
    companyInfo.ein.replace('-','').replace(/\D/g,'').padStart(10,'0') +
    'PPD' +                                          // standard entry class
    padRight('PAYROLL', 10) +
    effDate +
    '      ' +
    '1' +                                            // originator status
    companyInfo.routingNumber.slice(0,8) +
    '0000001'                                        // batch number
  );

  let entryCount   = 0;
  let debitTotal   = 0;
  let creditTotal  = 0;
  let hash         = 0;

  stubs.forEach((stub, i) => {
    if (!stub.employee?.bankAccount) return;
    const amount  = Math.round(Number(stub.netPay) * 100); // cents
    const routing = stub.employee.bankRouting ?? '000000000';
    const account = stub.employee.bankAccount;

    // Entry Detail (type 6)
    lines.push(
      '6' +
      '22' +                                         // transaction code: checking credit
      routing.slice(0,8) +
      '0' +                                          // check digit placeholder
      padRight(account, 17) +
      String(amount).padStart(10, '0') +
      padRight(stub.employee.ssn?.slice(-4) ?? '0000', 15) +
      padRight(`${stub.employee.firstName} ${stub.employee.lastName}`, 22) +
      '0' +                                          // addenda indicator
      companyInfo.routingNumber.slice(0,8) +
      String(i + 1).padStart(7, '0')
    );

    entryCount++;
    creditTotal += amount;
    hash += parseInt(routing.slice(0,8), 10);
  });

  // Company debit entry (pull from company account)
  lines.push(
    '6' +
    '27' +                                           // transaction code: checking debit
    companyInfo.routingNumber.slice(0,8) +
    '0' +
    padRight(companyInfo.accountNumber, 17) +
    String(creditTotal).padStart(10, '0') +
    padRight(companyInfo.ein, 15) +
    padRight(companyInfo.name, 22) +
    '0' +
    companyInfo.routingNumber.slice(0,8) +
    String(entryCount + 1).padStart(7, '0')
  );
  debitTotal += creditTotal;
  hash       += parseInt(companyInfo.routingNumber.slice(0,8), 10);
  entryCount++;

  // Batch Control (type 8)
  lines.push(
    '8' +
    '200' +
    String(entryCount).padStart(6,'0') +
    String(hash % 1e10).padStart(10,'0') +
    String(debitTotal).padStart(12,'0') +
    String(creditTotal).padStart(12,'0') +
    companyInfo.ein.replace(/\D/g,'').padStart(10,'0') +
    ' '.repeat(39) +
    companyInfo.routingNumber.slice(0,8) +
    '0000001'
  );

  // File Control (type 9)
  const blockCount = Math.ceil((lines.length + 1) / 10);
  lines.push(
    '9' +
    '000001' +                                       // batch count
    String(blockCount).padStart(6,'0') +
    String(entryCount).padStart(8,'0') +
    String(hash % 1e10).padStart(10,'0') +
    String(debitTotal).padStart(12,'0') +
    String(creditTotal).padStart(12,'0') +
    ' '.repeat(39)
  );

  // Pad to multiple of 10 lines
  while (lines.length % 10 !== 0) lines.push('9'.repeat(94));

  return lines.join('\n');
}

function padRight(str, len) {
  return String(str ?? '').slice(0, len).padEnd(len, ' ');
}

// ── Payroll journal entry posting ─────────────────────────────────────────────

export async function postPayrollJournalEntry(orgId, payRunId, userId) {
  const payRun = await prisma.payRun.findFirst({
    where:   { id: payRunId, orgId },
    include: { stubs: true },
  });
  if (!payRun) throw new Error('Pay run not found');

  const [wageAcct, cashAcct, taxPayable, ssPayable] = await Promise.all([
    prisma.account.findFirst({ where: { orgId, subtype: 'payroll_expense'     } }),
    prisma.account.findFirst({ where: { orgId, subtype: 'bank', isSystem: true } }),
    prisma.account.findFirst({ where: { orgId, subtype: 'tax_payable'          } }),
    prisma.account.findFirst({ where: { orgId, code: '2401'                    } })
      .then(a => a ?? prisma.account.create({ data: {
        orgId, code:'2401', name:'Payroll taxes payable',
        type:'liability', subtype:'tax_payable', normalBalance:'credit', isSystem:false,
      }})),
  ]);

  if (!wageAcct || !cashAcct) throw new Error('Payroll accounts not configured in chart of accounts');

  const totalGross  = payRun.stubs.reduce((s, st) => s + Number(st.grossPay),  0);
  const totalNet    = payRun.stubs.reduce((s, st) => s + Number(st.netPay),    0);
  const totalTaxes  = totalGross - totalNet;

  const seq = await prisma.sequence.update({
    where:  { orgId_name: { orgId, name: 'journal' } },
    data:   { nextVal: { increment: 1 } },
    select: { prefix: true, nextVal: true },
  });

  return prisma.journalEntry.create({
    data: {
      orgId,
      entryNumber:  `${seq.prefix}${String(seq.nextVal - 1).padStart(4, '0')}`,
      date:         payRun.payDate,
      description:  `Payroll run ${payRun.periodStart.toISOString().slice(0,10)} – ${payRun.periodEnd.toISOString().slice(0,10)}`,
      source:       'payroll',
      sourceId:     payRunId,
      status:       'posted',
      createdById:  userId,
      postedAt:     new Date(),
      lines: {
        createMany: {
          data: [
            { accountId: wageAcct.id,   debit: totalGross,  credit: 0           }, // DR Wages expense
            { accountId: cashAcct.id,   debit: 0,           credit: totalNet    }, // CR Cash (net pay)
            { accountId: ssPayable.id,  debit: 0,           credit: totalTaxes  }, // CR Taxes payable
          ],
        },
      },
    },
  });
}
