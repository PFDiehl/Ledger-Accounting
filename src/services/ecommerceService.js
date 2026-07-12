// E-commerce integration service
// Pulls orders, refunds, and fees from Shopify, WooCommerce, and Amazon Seller Central
// Maps them to invoices, bills, and journal entries

import prisma from '../lib/prisma.js';

// ── Shopify ───────────────────────────────────────────────────────────────────

export async function syncShopifyOrders(integration) {
  const { shopDomain, accessToken, orgId } = integration;
  const since = integration.lastSyncAt
    ? new Date(integration.lastSyncAt).toISOString()
    : new Date(Date.now() - 90 * 864e5).toISOString();

  const res = await fetch(
    `https://${shopDomain}/admin/api/2024-04/orders.json?status=any&created_at_min=${since}&limit=250`,
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  const { orders } = await res.json();

  const results = { created: 0, skipped: 0, errors: 0 };

  for (const order of orders) {
    try {
      // Skip if already imported
      const existing = await prisma.ecommerceOrder.findFirst({
        where: { orgId, externalId: String(order.id), platform: 'shopify' },
      });
      if (existing) { results.skipped++; continue; }

      const subtotal   = parseFloat(order.subtotal_price);
      const tax        = parseFloat(order.total_tax);
      const shipping   = parseFloat(order.total_shipping_price_set?.shop_money?.amount ?? 0);
      const discount   = parseFloat(order.total_discounts);
      const total      = parseFloat(order.total_price);
      const shopifyFee = Math.round(total * 0.029 + 0.30, 2); // approximate 2.9% + $0.30

      await prisma.ecommerceOrder.create({
        data: {
          orgId,
          platform:      'shopify',
          externalId:    String(order.id),
          orderNumber:   order.name,
          status:        order.financial_status,
          customerName:  `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim(),
          customerEmail: order.customer?.email ?? '',
          currency:      order.currency,
          subtotal,
          taxAmount:     tax,
          shippingAmount: shipping,
          discountAmount: discount,
          total,
          platformFee:   shopifyFee,
          netRevenue:    total - shopifyFee,
          orderedAt:     new Date(order.created_at),
          lineItems:     order.line_items.map(li => ({
            sku:         li.sku,
            name:        li.name,
            quantity:    li.quantity,
            price:       parseFloat(li.price),
            total:       parseFloat(li.price) * li.quantity,
          })),
        },
      });
      results.created++;
    } catch (err) {
      console.error(`[shopify] Failed for order ${order.id}:`, err.message);
      results.errors++;
    }
  }

  await prisma.ecommerceIntegration.update({
    where: { id: integration.id },
    data:  { lastSyncAt: new Date(), ordersImported: { increment: results.created } },
  });

  return results;
}

// ── WooCommerce ───────────────────────────────────────────────────────────────

export async function syncWooCommerceOrders(integration) {
  const { siteUrl, consumerKey, consumerSecret, orgId } = integration;
  const since = integration.lastSyncAt
    ? new Date(integration.lastSyncAt).toISOString()
    : new Date(Date.now() - 90 * 864e5).toISOString();

  const auth    = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res     = await fetch(
    `${siteUrl}/wp-json/wc/v3/orders?after=${since}&per_page=100&status=any`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
  const orders = await res.json();

  const results = { created: 0, skipped: 0, errors: 0 };

  for (const order of orders) {
    try {
      const existing = await prisma.ecommerceOrder.findFirst({
        where: { orgId, externalId: String(order.id), platform: 'woocommerce' },
      });
      if (existing) { results.skipped++; continue; }

      await prisma.ecommerceOrder.create({
        data: {
          orgId,
          platform:      'woocommerce',
          externalId:    String(order.id),
          orderNumber:   `#${order.number}`,
          status:        order.status,
          customerName:  `${order.billing.first_name} ${order.billing.last_name}`,
          customerEmail: order.billing.email,
          currency:      order.currency,
          subtotal:      parseFloat(order.subtotal),
          taxAmount:     parseFloat(order.total_tax),
          shippingAmount:parseFloat(order.shipping_total),
          discountAmount:parseFloat(order.discount_total),
          total:         parseFloat(order.total),
          platformFee:   0, // WooCommerce is self-hosted; fees depend on payment gateway
          netRevenue:    parseFloat(order.total),
          orderedAt:     new Date(order.date_created),
          lineItems:     order.line_items.map(li => ({
            sku:      li.sku,
            name:     li.name,
            quantity: li.quantity,
            price:    parseFloat(li.price),
            total:    parseFloat(li.total),
          })),
        },
      });
      results.created++;
    } catch (err) {
      results.errors++;
    }
  }

  await prisma.ecommerceIntegration.update({
    where: { id: integration.id },
    data:  { lastSyncAt: new Date(), ordersImported: { increment: results.created } },
  });

  return results;
}

// ── Amazon Seller Central ─────────────────────────────────────────────────────

export async function syncAmazonOrders(integration) {
  // Amazon uses SP-API (Selling Partner API) with LWA OAuth
  // This implements the Orders API v0
  const { sellerId, accessToken, marketplaceId, orgId } = integration;

  const since = integration.lastSyncAt
    ? new Date(integration.lastSyncAt).toISOString()
    : new Date(Date.now() - 90 * 864e5).toISOString();

  const endpoint = 'https://sellingpartnerapi-na.amazon.com';
  const res      = await fetch(
    `${endpoint}/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=${since}&OrderStatuses=Shipped,Unshipped`,
    {
      headers: {
        'x-amz-access-token': accessToken,
        'Content-Type':       'application/json',
      },
    }
  );

  if (!res.ok) throw new Error(`Amazon SP-API error: ${res.status}`);
  const data   = await res.json();
  const orders = data.payload?.Orders ?? [];

  const results = { created: 0, skipped: 0, errors: 0 };

  for (const order of orders) {
    try {
      const existing = await prisma.ecommerceOrder.findFirst({
        where: { orgId, externalId: order.AmazonOrderId, platform: 'amazon' },
      });
      if (existing) { results.skipped++; continue; }

      const total      = parseFloat(order.OrderTotal?.Amount ?? 0);
      const amazonFee  = Math.round(total * 0.15 * 100) / 100; // ~15% referral fee estimate

      await prisma.ecommerceOrder.create({
        data: {
          orgId,
          platform:      'amazon',
          externalId:    order.AmazonOrderId,
          orderNumber:   order.AmazonOrderId,
          status:        order.OrderStatus,
          customerName:  order.BuyerInfo?.BuyerName ?? 'Amazon Customer',
          customerEmail: order.BuyerInfo?.BuyerEmail ?? '',
          currency:      order.OrderTotal?.CurrencyCode ?? 'USD',
          subtotal:      total,
          taxAmount:     0, // Amazon collects/remits tax in most states
          shippingAmount:0,
          discountAmount:0,
          total,
          platformFee:   amazonFee,
          netRevenue:    total - amazonFee,
          orderedAt:     new Date(order.PurchaseDate),
          lineItems:     [],
        },
      });
      results.created++;
    } catch (err) {
      results.errors++;
    }
  }

  await prisma.ecommerceIntegration.update({
    where: { id: integration.id },
    data:  { lastSyncAt: new Date(), ordersImported: { increment: results.created } },
  });

  return results;
}

// ── Post orders to accounting ─────────────────────────────────────────────────
// Converts imported e-commerce orders into journal entries

export async function postOrdersToAccounting(orgId, userId, options = {}) {
  const { platform, since } = options;
  const unposted = await prisma.ecommerceOrder.findMany({
    where: {
      orgId,
      postedAt: null,
      status:   { in: ['paid', 'completed', 'Shipped'] },
      ...(platform && { platform }),
      ...(since    && { orderedAt: { gte: new Date(since) } }),
    },
    take: 100,
  });

  if (!unposted.length) return { posted: 0 };

  // Look up required accounts
  const [revenueAcct, cashAcct, feeAcct] = await Promise.all([
    prisma.account.findFirst({ where: { orgId, subtype:'operating_revenue', isSystem:true } }),
    prisma.account.findFirst({ where: { orgId, subtype:'bank',              isSystem:true } }),
    prisma.account.findFirst({ where: { orgId, code:'6500' } })
      .then(a => a ?? prisma.account.create({ data: {
        orgId, code:'6500', name:'Platform fees & commissions',
        type:'expense', subtype:'other_expense', normalBalance:'debit', isSystem:false,
      }})),
  ]);

  if (!revenueAcct || !cashAcct) throw new Error('Required accounts not found in chart of accounts');

  let posted = 0;
  for (const order of unposted) {
    try {
      const seq = await prisma.sequence.update({
        where:  { orgId_name: { orgId, name: 'journal' } },
        data:   { nextVal: { increment: 1 } },
        select: { prefix: true, nextVal: true },
      });

      await prisma.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: {
            orgId,
            entryNumber:  `${seq.prefix}${String(seq.nextVal - 1).padStart(4,'0')}`,
            date:         order.orderedAt,
            description:  `${order.platform} order ${order.orderNumber} — ${order.customerName}`,
            source:       'ecommerce',
            sourceId:     order.id,
            status:       'posted',
            createdById:  userId,
            postedAt:     new Date(),
            lines: {
              createMany: {
                data: [
                  { accountId: cashAcct.id,    debit: order.netRevenue, credit: 0               },
                  ...(order.platformFee > 0 ? [{ accountId: feeAcct.id, debit: order.platformFee, credit: 0 }] : []),
                  { accountId: revenueAcct.id, debit: 0,                credit: Number(order.total) },
                ],
              },
            },
          },
        });
        await tx.ecommerceOrder.update({
          where: { id: order.id },
          data:  { postedAt: new Date() },
        });
      });
      posted++;
    } catch (err) {
      console.error(`[ecommerce] Failed to post order ${order.id}:`, err.message);
    }
  }

  return { posted, total: unposted.length };
}
