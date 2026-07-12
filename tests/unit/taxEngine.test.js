import { describe, it, expect } from '@jest/globals';
import { calculatePayStub, calcGrossPay, calcEmployerTaxes } from '../../src/services/taxEngine.js';

describe('Tax engine — calculatePayStub', () => {

  it('calculates FICA correctly for a standard salary employee', () => {
    const result = calculatePayStub({
      grossPay:     3846.15, // ~$100k / 26
      ytdGross:     0,
      payFrequency: 'biweekly',
      filingStatus: 'single',
      stateCode:    'TX',    // no state income tax
    });

    expect(result.grossPay).toBeCloseTo(3846.15, 1);
    // SS: 3846.15 * 0.062
    expect(result.socialSecurity).toBeCloseTo(238.46, 1);
    // Medicare: 3846.15 * 0.0145
    expect(result.medicare).toBeCloseTo(55.77, 1);
    // No state tax in TX
    expect(result.stateTax).toBe(0);
    // Net pay should be less than gross
    expect(result.netPay).toBeLessThan(result.grossPay);
    // Net + deductions should equal gross
    const deductions = result.federalTax + result.stateTax + result.socialSecurity + result.medicare;
    expect(result.netPay).toBeCloseTo(result.grossPay - deductions, 2);
  });

  it('caps Social Security at wage base mid-year', () => {
    // Employee is near the SS wage base ($176,100 in 2025)
    const result = calculatePayStub({
      grossPay:     3000,
      ytdGross:     174500, // only $1,600 remaining before cap
      payFrequency: 'biweekly',
      filingStatus: 'single',
      stateCode:    'TX',
    });

    // Only 176100 - 174500 = 1600 is SS-eligible
    expect(result.socialSecurity).toBeCloseTo(1600 * 0.062, 2);
    // Medicare has no cap
    expect(result.medicare).toBeCloseTo(3000 * 0.0145, 2);
  });

  it('applies additional Medicare tax over $200k YTD', () => {
    const result = calculatePayStub({
      grossPay:     5000,
      ytdGross:     198000, // crosses $200k this period
      payFrequency: 'biweekly',
      filingStatus: 'single',
      stateCode:    'TX',
    });

    // Regular Medicare on full $5000
    const baseMedicare = 5000 * 0.0145;
    // Additional 0.9% on amount over $200k threshold
    const addlMedicare = (198000 + 5000 - 200000) * 0.009;
    expect(result.medicare).toBeCloseTo(baseMedicare + addlMedicare, 1);
  });

  it('applies state income tax for CA', () => {
    const result = calculatePayStub({
      grossPay:     5000,
      ytdGross:     0,
      payFrequency: 'biweekly',
      filingStatus: 'single',
      stateCode:    'CA',
    });
    // CA ~9.3% effective rate at this income
    expect(result.stateTax).toBeGreaterThan(0);
  });

  it('married filing jointly has lower federal tax than single at same income', () => {
    const single = calculatePayStub({ grossPay: 5000, ytdGross: 0, payFrequency: 'biweekly', filingStatus: 'single',  stateCode: 'TX' });
    const mfj    = calculatePayStub({ grossPay: 5000, ytdGross: 0, payFrequency: 'biweekly', filingStatus: 'mfj',     stateCode: 'TX' });
    expect(mfj.federalTax).toBeLessThan(single.federalTax);
  });

  it('returns zero net pay guard — net is never negative', () => {
    // Extremely low grossPay edge case
    const result = calculatePayStub({ grossPay: 10, ytdGross: 0, payFrequency: 'weekly', filingStatus: 'single', stateCode: 'CA' });
    expect(result.netPay).toBeGreaterThanOrEqual(0);
  });
});

describe('Tax engine — calcGrossPay', () => {
  it('calculates biweekly salary gross correctly', () => {
    const emp = { payType: 'salary', payRate: 100000, payFrequency: 'biweekly' };
    const gross = calcGrossPay(emp, '2026-06-01', '2026-06-14');
    expect(gross).toBeCloseTo(100000 / 26, 2);
  });

  it('calculates hourly gross for a 10-day period', () => {
    const emp = { payType: 'hourly', payRate: 50, payFrequency: 'biweekly' };
    const gross = calcGrossPay(emp, '2026-06-01', '2026-06-14');
    expect(gross).toBeGreaterThan(0);
    expect(gross).toBeLessThan(50 * 80 * 1.2); // within 20% of expected
  });
});

describe('Tax engine — calcEmployerTaxes', () => {
  it('calculates FUTA correctly', () => {
    // FUTA: 0.6% on first $7,000 per employee
    const result = calcEmployerTaxes(3000, 0, 'TX');
    expect(result.futa).toBeCloseTo(3000 * 0.006, 2);
  });

  it('stops FUTA after $7,000 wage base', () => {
    // Employee already earned $7,000+ this year
    const result = calcEmployerTaxes(3000, 7500, 'TX');
    expect(result.futa).toBe(0);
  });

  it('employer SS matches employee SS', () => {
    const employee = calculatePayStub({ grossPay: 3000, ytdGross: 0, payFrequency: 'biweekly', filingStatus: 'single', stateCode: 'TX' });
    const employer = calcEmployerTaxes(3000, 0, 'TX');
    expect(employer.employerSS).toBeCloseTo(employee.socialSecurity, 2);
  });
});
