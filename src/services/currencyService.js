import prisma from '../lib/prisma.js';

// ── Exchange rate fetching (Open Exchange Rates) ──────────────────────────────
// Free tier: https://openexchangerates.org/
// Alternatively: European Central Bank (ECB) — free, EUR base only

export async function fetchLatestRates(baseCurrency = 'USD') {
  const appId = process.env.OPENEXCHANGERATES_APP_ID;

  if (!appId) {
    // Fallback: use hardcoded approximate rates for development
    return getDevRates(baseCurrency);
  }

  const res  = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${appId}&base=${baseCurrency}`);
  const data = await res.json();

  if (!res.ok) throw new Error(data.message ?? 'Failed to fetch exchange rates');

  return data.rates; // { EUR: 0.92, GBP: 0.79, ... }
}

function getDevRates(base) {
  // Approximate rates as of mid-2025
  const usdRates = {
    EUR: 0.9204, GBP: 0.7891, JPY: 157.42, CAD: 1.3621,
    AUD: 1.5234, CHF: 0.8923, CNY: 7.2415, INR: 83.45,
    MXN: 17.12,  BRL: 4.97,   SGD: 1.3401, HKD: 7.8124,
    NZD: 1.6312, SEK: 10.42,  NOK: 10.58,  DKK: 6.8721,
    KRW: 1324.5, ZAR: 18.23,  AED: 3.6725,
    USD: 1.0,
  };

  if (base === 'USD') return usdRates;

  const baseRate = usdRates[base] ?? 1;
  const result = {};
  Object.entries(usdRates).forEach(([currency, rate]) => {
    result[currency] = Math.round((rate / baseRate) * 1000000) / 1000000;
  });
  return result;
}

// ── Sync rates to database ────────────────────────────────────────────────────

export async function syncExchangeRates(orgId, baseCurrency = 'USD') {
  const rates = await fetchLatestRates(baseCurrency);
  const today = new Date().toISOString().slice(0, 10);

  const data = Object.entries(rates)
    .filter(([currency]) => currency !== baseCurrency)
    .map(([toCurrency, rate]) => ({
      orgId,
      fromCurrency: baseCurrency,
      toCurrency,
      rate,
      source:       process.env.OPENEXCHANGERATES_APP_ID ? 'openexchangerates' : 'development',
      effectiveAt:  new Date(today),
    }));

  await prisma.exchangeRate.createMany({ data, skipDuplicates: true });
  return data.length;
}

// ── Get rate for conversion ───────────────────────────────────────────────────

export async function getRate(orgId, fromCurrency, toCurrency, date = new Date()) {
  if (fromCurrency === toCurrency) return 1;

  // Look up in DB, get the most recent rate on or before the given date
  const rate = await prisma.exchangeRate.findFirst({
    where: {
      orgId,
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency:   toCurrency.toUpperCase(),
      effectiveAt:  { lte: date },
    },
    orderBy: { effectiveAt: 'desc' },
  });

  if (rate) return Number(rate.rate);

  // Try inverse rate
  const inverse = await prisma.exchangeRate.findFirst({
    where: {
      orgId,
      fromCurrency: toCurrency.toUpperCase(),
      toCurrency:   fromCurrency.toUpperCase(),
      effectiveAt:  { lte: date },
    },
    orderBy: { effectiveAt: 'desc' },
  });

  if (inverse) return 1 / Number(inverse.rate);

  // Fall back to live dev rates
  const rates = getDevRates(fromCurrency);
  return rates[toCurrency] ?? 1;
}

// ── Convert amount ────────────────────────────────────────────────────────────

export async function convert(orgId, amount, fromCurrency, toCurrency, date) {
  const rate = await getRate(orgId, fromCurrency, toCurrency, date);
  return Math.round(amount * rate * 100) / 100;
}

// ── Format currency ───────────────────────────────────────────────────────────

export function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style:    'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export const SUPPORTED_CURRENCIES = [
  { code:'USD', name:'US Dollar',          symbol:'$'  },
  { code:'EUR', name:'Euro',               symbol:'€'  },
  { code:'GBP', name:'British Pound',      symbol:'£'  },
  { code:'CAD', name:'Canadian Dollar',    symbol:'CA$'},
  { code:'AUD', name:'Australian Dollar',  symbol:'A$' },
  { code:'JPY', name:'Japanese Yen',       symbol:'¥'  },
  { code:'CHF', name:'Swiss Franc',        symbol:'CHF'},
  { code:'INR', name:'Indian Rupee',       symbol:'₹'  },
  { code:'MXN', name:'Mexican Peso',       symbol:'MX$'},
  { code:'BRL', name:'Brazilian Real',     symbol:'R$' },
  { code:'SGD', name:'Singapore Dollar',   symbol:'S$' },
  { code:'HKD', name:'Hong Kong Dollar',   symbol:'HK$'},
  { code:'NZD', name:'New Zealand Dollar', symbol:'NZ$'},
  { code:'SEK', name:'Swedish Krona',      symbol:'kr' },
  { code:'NOK', name:'Norwegian Krone',    symbol:'kr' },
  { code:'DKK', name:'Danish Krone',       symbol:'kr' },
  { code:'KRW', name:'South Korean Won',   symbol:'₩'  },
  { code:'ZAR', name:'South African Rand', symbol:'R'  },
  { code:'AED', name:'UAE Dirham',         symbol:'AED'},
  { code:'CNY', name:'Chinese Yuan',       symbol:'¥'  },
];
