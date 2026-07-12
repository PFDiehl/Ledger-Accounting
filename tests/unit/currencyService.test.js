import { describe, it, expect } from '@jest/globals';
import { formatCurrency, SUPPORTED_CURRENCIES } from '../../src/services/currencyService.js';

describe('Currency service', () => {

  describe('formatCurrency', () => {
    it('formats USD correctly', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(result).toBe('$1,234.56');
    });

    it('formats EUR correctly', () => {
      const result = formatCurrency(1000, 'EUR');
      expect(result).toContain('1,000');
      expect(result).toContain('€');
    });

    it('formats JPY with no decimals', () => {
      const result = formatCurrency(15000, 'JPY');
      expect(result).not.toContain('.');
    });

    it('handles zero', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toBe('$0.00');
    });

    it('handles negative amounts', () => {
      const result = formatCurrency(-500, 'USD');
      expect(result).toContain('500');
    });
  });

  describe('SUPPORTED_CURRENCIES', () => {
    it('contains at least 15 currencies', () => {
      expect(SUPPORTED_CURRENCIES.length).toBeGreaterThanOrEqual(15);
    });

    it('includes USD, EUR, GBP', () => {
      const codes = SUPPORTED_CURRENCIES.map(c => c.code);
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
      expect(codes).toContain('GBP');
    });

    it('each currency has code, name, and symbol', () => {
      SUPPORTED_CURRENCIES.forEach(c => {
        expect(c.code).toHaveLength(3);
        expect(c.name).toBeTruthy();
        expect(c.symbol).toBeTruthy();
      });
    });

    it('all currency codes are uppercase', () => {
      SUPPORTED_CURRENCIES.forEach(c => {
        expect(c.code).toBe(c.code.toUpperCase());
      });
    });
  });
});
