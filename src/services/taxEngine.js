// US Payroll Tax Engine
// Federal rates: IRS Publication 15-T (2025)
// FICA: Social Security 6.2% up to $176,100 wage base; Medicare 1.45% (+ 0.9% over $200k)
// State rates: flat approximations per state — replace with actual state tables for production

// ── Federal income tax brackets (2025, single, per pay period annualized) ─────

const FEDERAL_BRACKETS_SINGLE = [
  { min: 0,       max: 11925,  rate: 0.10, base: 0        },
  { min: 11925,   max: 48475,  rate: 0.12, base: 1192.50  },
  { min: 48475,   max: 103350, rate: 0.22, base: 5578.50  },
  { min: 103350,  max: 197300, rate: 0.24, base: 17651.50 },
  { min: 197300,  max: 250525, rate: 0.32, base: 40199.50 },
  { min: 250525,  max: 626350, rate: 0.35, base: 57231.50 },
  { min: 626350,  max: Infinity,rate: 0.37, base: 188769.75},
];

const FEDERAL_BRACKETS_MFJ = [
  { min: 0,       max: 23850,  rate: 0.10, base: 0        },
  { min: 23850,   max: 96950,  rate: 0.12, base: 2385.00  },
  { min: 96950,   max: 206700, rate: 0.22, base: 11157.00 },
  { min: 206700,  max: 394600, rate: 0.24, base: 35302.00 },
  { min: 394600,  max: 501050, rate: 0.32, base: 80398.00 },
  { min: 501050,  max: 751600, rate: 0.35, base: 114462.00},
  { min: 751600,  max: Infinity,rate: 0.37, base: 202154.50},
];

// Standard deduction 2025
const STD_DEDUCTION = { single: 15000, mfj: 30000 };

// FICA limits 2025
const SS_WAGE_BASE   = 176100;
const SS_RATE        = 0.062;
const MEDICARE_RATE  = 0.0145;
const ADD_MEDICARE   = 0.009;   // additional 0.9% over $200k
const ADD_MEDICARE_THRESHOLD = 200000;

// ── State flat rates (approximate — use state-specific tables for production) ──

const STATE_RATES = {
  AL: 0.050, AK: 0.000, AZ: 0.025, AR: 0.047, CA: 0.093, CO: 0.044,
  CT: 0.050, DE: 0.066, FL: 0.000, GA: 0.055, HI: 0.080, ID: 0.058,
  IL: 0.049, IN: 0.030, IA: 0.060, KS: 0.057, KY: 0.045, LA: 0.042,
  ME: 0.075, MD: 0.058, MA: 0.050, MI: 0.043, MN: 0.068, MS: 0.050,
  MO: 0.054, MT: 0.069, NE: 0.068, NV: 0.000, NH: 0.000, NJ: 0.065,
  NM: 0.059, NY: 0.085, NC: 0.047, ND: 0.029, OH: 0.040, OK: 0.050,
  OR: 0.099, PA: 0.031, RI: 0.060, SC: 0.070, SD: 0.000, TN: 0.000,
  TX: 0.000, UT: 0.046, VT: 0.086, VA: 0.058, WA: 0.000, WV: 0.065,
  WI: 0.076, WY: 0.000, DC: 0.086,
};

// ── Tax calculation ───────────────────────────────────────────────────────────

function calcFederalIncomeTax(annualGross, filingStatus = 'single') {
  const brackets = filingStatus === 'mfj' ? FEDERAL_BRACKETS_MFJ : FEDERAL_BRACKETS_SINGLE;
  const stdDed   = filingStatus === 'mfj' ? STD_DEDUCTION.mfj    : STD_DEDUCTION.single;
  const taxable  = Math.max(0, annualGross - stdDed);

  let tax = 0;
  for (const bracket of brackets) {
    if (taxable <= bracket.min) break;
    const taxableInBracket = Math.min(taxable, bracket.max) - bracket.min;
    tax = bracket.base + taxableInBracket * bracket.rate;
  }
  return tax;
}

function calcFICA(grossPay, ytdGross) {
  // Social Security — only on wages up to wage base
  const ssEligible = Math.max(0, Math.min(grossPay, SS_WAGE_BASE - ytdGross));
  const ss         = Math.round(ssEligible * SS_RATE * 100) / 100;

  // Medicare — no wage base cap
  const medicare   = Math.round(grossPay * MEDICARE_RATE * 100) / 100;

  // Additional Medicare tax on high earners
  const addMedicare = ytdGross + grossPay > ADD_MEDICARE_THRESHOLD
    ? Math.round(Math.max(0, ytdGross + grossPay - ADD_MEDICARE_THRESHOLD) * ADD_MEDICARE * 100) / 100
    : 0;

  return { socialSecurity: ss, medicare: medicare + addMedicare };
}

function calcStateTax(annualGross, stateCode) {
  const rate = STATE_RATES[stateCode?.toUpperCase()] ?? 0;
  return Math.round(annualGross * rate * 100) / 100;
}

// ── Per-period calculation ────────────────────────────────────────────────────

const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export function calculatePayStub({
  grossPay,              // this period's gross pay
  ytdGross = 0,          // year-to-date gross BEFORE this period
  payFrequency = 'biweekly',
  filingStatus = 'single',
  stateCode    = null,
  allowances   = 0,      // W-4 allowances (pre-2020 W-4)
}) {
  const periods     = PERIODS_PER_YEAR[payFrequency] ?? 26;
  const annualGross = grossPay * periods;

  // Allowances reduce taxable income (pre-2020 W-4: $4,300 per allowance)
  const allowanceAdjustment = allowances * 4300;
  const adjAnnualGross = Math.max(0, annualGross - allowanceAdjustment);

  // Federal income tax (annualized method)
  const annualFederalTax = calcFederalIncomeTax(adjAnnualGross, filingStatus);
  const federalTax       = Math.round((annualFederalTax / periods) * 100) / 100;

  // FICA
  const { socialSecurity, medicare } = calcFICA(grossPay, ytdGross);

  // State income tax
  const annualStateTax  = calcStateTax(adjAnnualGross, stateCode);
  const stateTax        = Math.round((annualStateTax / periods) * 100) / 100;

  const totalDeductions = federalTax + socialSecurity + medicare + stateTax;
  const netPay          = Math.round((grossPay - totalDeductions) * 100) / 100;

  return {
    grossPay:      Math.round(grossPay * 100) / 100,
    federalTax,
    stateTax,
    socialSecurity,
    medicare,
    otherDeductions: 0,
    netPay,
    effectiveRate: annualGross > 0 ? Math.round((totalDeductions / grossPay) * 10000) / 100 : 0,
  };
}

// ── Gross pay calculator ──────────────────────────────────────────────────────

export function calcGrossPay(employee, periodStart, periodEnd) {
  const periods = PERIODS_PER_YEAR[employee.payFrequency] ?? 26;

  if (employee.payType === 'salary') {
    return Math.round((Number(employee.payRate) / periods) * 100) / 100;
  }

  // Hourly: assume standard hours for the period
  const days = (new Date(periodEnd) - new Date(periodStart)) / 864e5 + 1;
  const workdays = Math.round(days * 5 / 7); // approximate business days
  const hours    = workdays * 8;
  return Math.round(Number(employee.payRate) * hours * 100) / 100;
}

// ── Employer taxes (not withheld from employee — paid by employer) ─────────────

export function calcEmployerTaxes(grossPay, ytdGross, stateCode) {
  const { socialSecurity, medicare } = calcFICA(grossPay, ytdGross);

  // FUTA: 6% on first $7,000 (net 0.6% after state credit in most states)
  const futaBase    = Math.max(0, Math.min(grossPay, 7000 - ytdGross));
  const futa        = Math.round(futaBase * 0.006 * 100) / 100;

  // SUTA: varies widely; approximating at 2.7% on first $7,000-$47,600 depending on state
  const sutaBase    = Math.max(0, Math.min(grossPay, 15000 - ytdGross));
  const suta        = Math.round(sutaBase * 0.027 * 100) / 100;

  return {
    employerSS:       socialSecurity,
    employerMedicare: medicare,
    futa,
    suta,
  };
}
