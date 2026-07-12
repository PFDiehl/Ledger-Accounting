// Plaid integration service
// Docs: https://plaid.com/docs/api/
// Install: npm install plaid

// We use dynamic import so the service degrades gracefully when
// the plaid package isn't installed or env vars aren't set.

const PLAID_ENV_URLS = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};

function getConfig() {
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV = 'sandbox' } = process.env;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error('Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.');
  }
  return { clientId: PLAID_CLIENT_ID, secret: PLAID_SECRET, baseUrl: PLAID_ENV_URLS[PLAID_ENV] };
}

async function plaidPost(path, body) {
  const { clientId, secret, baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_message ?? `Plaid error: ${data.error_code}`);
  return data;
}

// ── Step 1: Create a Link token for the frontend to initialise Plaid Link ──────

export async function createLinkToken({ userId, orgId }) {
  return plaidPost('/link/token/create', {
    user:       { client_user_id: `${orgId}:${userId}` },
    client_name: 'Ledger',
    products:   ['transactions'],
    country_codes: ['US'],
    language:   'en',
  });
}

// ── Step 2: Exchange public token for access token (called once after Link) ────

export async function exchangePublicToken(publicToken) {
  return plaidPost('/item/public_token/exchange', { public_token: publicToken });
  // Returns { access_token, item_id }
}

// ── Step 3: Get account info from Plaid ────────────────────────────────────────

export async function getAccounts(accessToken) {
  return plaidPost('/accounts/get', { access_token: accessToken });
}

// ── Step 4: Sync transactions (cursor-based, handles adds/removes/updates) ─────

export async function syncTransactions(accessToken, cursor = null) {
  let added   = [];
  let modified = [];
  let removed  = [];
  let nextCursor = cursor;
  let hasMore  = true;

  while (hasMore) {
    const res = await plaidPost('/transactions/sync', {
      access_token: accessToken,
      cursor:       nextCursor,
      count:        500,
    });

    added    = [...added,    ...res.added];
    modified = [...modified, ...res.modified];
    removed  = [...removed,  ...res.removed];
    nextCursor = res.next_cursor;
    hasMore    = res.has_more;
  }

  return { added, modified, removed, nextCursor };
}

// ── Normalize Plaid transaction to our DB shape ────────────────────────────────

export function normalizePlaidTransaction(plaidTxn, bankAccountId, orgId) {
  return {
    orgId,
    bankAccountId,
    plaidTxnId:   plaidTxn.transaction_id,
    date:         new Date(plaidTxn.date),
    description:  plaidTxn.name,
    amount:       -plaidTxn.amount,              // Plaid: positive = debit; we: negative = debit
    currency:     (plaidTxn.iso_currency_code ?? 'USD').toUpperCase(),
    merchantName: plaidTxn.merchant_name ?? null,
    category:     plaidTxn.personal_finance_category?.primary ?? null,
    status:       'unreviewed',
  };
}
