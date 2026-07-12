import { describe, it, expect } from '@jest/globals';
import { calcInvoiceTotals } from '../../src/services/invoiceService.js';

describe('invoiceService — calcInvoiceTotals', () => {

  it('calculates a single line item with no tax', () => {
    const result = calcInvoiceTotals([
      { description: 'Consulting', quantity: 1, unitPrice: 1000, taxRate: 0 },
    ]);
    expect(result.subtotal).toBe(1000);
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(1000);
    expect(result.lines[0].amount).toBe(1000);
    expect(result.lines[0].taxAmount).toBe(0);
  });

  it('calculates multiple line items with mixed quantities', () => {
    const result = calcInvoiceTotals([
      { description: 'Hours', quantity: 10, unitPrice: 150, taxRate: 0 },
      { description: 'Hosting', quantity: 1, unitPrice: 99,  taxRate: 0 },
    ]);
    expect(result.subtotal).toBe(1599);
    expect(result.total).toBe(1599);
    expect(result.lines[0].amount).toBe(1500);
    expect(result.lines[1].amount).toBe(99);
  });

  it('calculates tax correctly on line items', () => {
    const result = calcInvoiceTotals([
      { description: 'Product', quantity: 2, unitPrice: 100, taxRate: 8.5 },
    ]);
    expect(result.subtotal).toBe(200);
    expect(result.taxAmount).toBeCloseTo(17, 2); // 200 * 0.085
    expect(result.total).toBeCloseTo(217, 2);
  });

  it('rounds to 2 decimal places', () => {
    const result = calcInvoiceTotals([
      { description: 'Item', quantity: 3, unitPrice: 10.333, taxRate: 0 },
    ]);
    // 3 * 10.333 = 30.999 → rounds to 31.00
    expect(result.subtotal).toBeCloseTo(30.999, 2);
    const str = result.subtotal.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('handles fractional quantities', () => {
    const result = calcInvoiceTotals([
      { description: 'Hours', quantity: 2.5, unitPrice: 200, taxRate: 0 },
    ]);
    expect(result.subtotal).toBe(500);
  });

  it('handles empty line items gracefully', () => {
    const result = calcInvoiceTotals([]);
    expect(result.subtotal).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(0);
  });

  it('mixes taxed and untaxed lines', () => {
    const result = calcInvoiceTotals([
      { description: 'Service',  quantity: 1, unitPrice: 500, taxRate: 0   },
      { description: 'Product',  quantity: 1, unitPrice: 100, taxRate: 10  },
    ]);
    expect(result.subtotal).toBe(600);
    expect(result.taxAmount).toBeCloseTo(10, 2);
    expect(result.total).toBeCloseTo(610, 2);
  });
});
