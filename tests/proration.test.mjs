import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  addMonthsClamped,
  billingPeriod,
  daysBetween,
  planChange,
  prorate,
  ProrationError,
} from '../dist/esm/index.js';

test('addMonthsClamped clamps short months and honours the anchor day', () => {
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonthsClamped('2023-01-31', 1), '2023-02-28');
  assert.equal(addMonthsClamped('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonthsClamped('2024-02-29', 1, 31), '2024-03-31');
  assert.equal(addMonthsClamped('2024-03-15', -3), '2023-12-15');
  assert.equal(addMonthsClamped(new Date(Date.UTC(2024, 10, 30, 23, 59)), 3), '2025-02-28');
  assert.equal(addMonthsClamped('2024-05-10', 0), '2024-05-10');
});

test('daysBetween counts UTC calendar days across leap years', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2023-02-28', '2023-03-01'), 1);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
  assert.equal(daysBetween('2024-03-01', '2024-02-01'), -29);
  assert.equal(
    daysBetween(new Date(Date.UTC(2024, 0, 1, 23)), new Date(Date.UTC(2024, 0, 2, 1))),
    1,
  );
});

test('billingPeriod is half-open and returns to the anchor day after short months', () => {
  assert.deepEqual(billingPeriod('2024-01-31', '2024-01-31'), {
    index: 0,
    start: '2024-01-31',
    end: '2024-02-29',
    days: 29,
  });
  assert.deepEqual(billingPeriod('2024-01-31', '2024-02-28'), {
    index: 0,
    start: '2024-01-31',
    end: '2024-02-29',
    days: 29,
  });
  assert.deepEqual(billingPeriod('2024-01-31', '2024-02-29'), {
    index: 1,
    start: '2024-02-29',
    end: '2024-03-31',
    days: 31,
  });
  assert.deepEqual(billingPeriod('2024-01-31', '2024-03-31'), {
    index: 2,
    start: '2024-03-31',
    end: '2024-04-30',
    days: 30,
  });
  assert.deepEqual(billingPeriod('2024-01-15', '2025-01-14'), {
    index: 11,
    start: '2024-12-15',
    end: '2025-01-15',
    days: 31,
  });
  assert.throws(
    () => billingPeriod('2024-01-15', '2024-01-14'),
    (e) => e.code === 'out-of-range',
  );
  // Oracle: stepping day by day never leaves the reported period.
  for (let i = 0; i < 400; i += 1) {
    const day = new Date(Date.UTC(2024, 0, 31) + i * 86_400_000).toISOString().slice(0, 10);
    const p = billingPeriod('2024-01-31', day);
    assert.ok(p.start <= day && day < p.end, day);
  }
});

test('actual method prorates exactly and rounds with the documented half-even default', () => {
  const base = { periodStart: '2024-02-01', periodEnd: '2024-03-01', changeAt: '2024-02-16' };
  const r = prorate({ ...base, priceCents: 2900n });
  assert.deepEqual([r.totalDays, r.remainingDays, r.amountCents], [29, 14, 1400n]);
  assert.equal(prorate({ ...base, priceCents: 1000n }).amountCents, 483n); // 482.758..
  assert.equal(prorate({ ...base, priceCents: 1n, changeAt: '2024-02-01' }).amountCents, 1n);
  assert.equal(prorate({ ...base, priceCents: 1000n, changeAt: '2024-03-01' }).amountCents, 0n);
  // exact tie: 1 cent * 1 / 2 days
  const tie = {
    priceCents: 1n,
    periodStart: '2024-01-01',
    periodEnd: '2024-01-03',
    changeAt: '2024-01-02',
  };
  assert.equal(prorate(tie).amountCents, 0n);
  assert.equal(prorate({ ...tie, rounding: 'half-up' }).amountCents, 1n);
  assert.equal(prorate({ ...tie, rounding: 'ceil' }).amountCents, 1n);
  assert.equal(
    prorate({ ...base, priceCents: 10n ** 30n }).amountCents,
    (10n ** 30n * 14n + 14n) / 29n,
  );
});

test('fixed-day method uses the supplied divisor and caps the charged days', () => {
  const jan = {
    priceCents: 3000n,
    periodStart: '2024-01-01',
    periodEnd: '2024-02-01',
    method: 'fixed',
    fixedDays: 30,
  };
  assert.equal(prorate({ ...jan, changeAt: '2024-01-16' }).amountCents, 1600n); // 16 days * 100
  assert.equal(prorate({ ...jan, changeAt: '2024-01-01' }).amountCents, 3000n); // 31 days capped to 30
  assert.equal(prorate({ ...jan, changeAt: '2024-01-01' }).chargedDays, 30);
  const feb = {
    ...jan,
    periodStart: '2024-02-01',
    periodEnd: '2024-03-01',
    changeAt: '2024-02-16',
  };
  assert.equal(prorate(feb).amountCents, 1400n); // 14 days * 100 even though the month has 29
  const { fixedDays, ...rest } = feb;
  assert.equal(prorate({ ...rest, method: 'actual' }).amountCents, 1448n); // 14/29 of 3000 = 1448.27
});

test('planChange nets credit against new charge, including downgrades', () => {
  const span = { periodStart: '2024-04-01', periodEnd: '2024-05-01', changeAt: '2024-04-11' };
  const up = planChange({ ...span, oldPriceCents: 3000n, newPriceCents: 6000n });
  assert.deepEqual([up.creditCents, up.chargeCents, up.netCents], [2000n, 4000n, 2000n]);
  const down = planChange({ ...span, oldPriceCents: 6000n, newPriceCents: 3000n });
  assert.equal(down.netCents, -2000n);
  const odd = planChange({ ...span, oldPriceCents: 999n, newPriceCents: 999n });
  assert.equal(odd.netCents, 0n);
  assert.equal(odd.creditCents, 666n);
  assert.deepEqual([odd.remainingDays, odd.totalDays], [20, 30]);
});

test('invalid dates, amounts, ranges and mixed policies are rejected', () => {
  const ok = {
    priceCents: 100n,
    periodStart: '2024-01-01',
    periodEnd: '2024-02-01',
    changeAt: '2024-01-10',
  };
  for (const patch of [
    { priceCents: -1n },
    { priceCents: 1.5 },
    { priceCents: '1' },
    { periodStart: '2024-02-30' },
    { periodStart: '2024-1-01' },
    { periodStart: new Date(NaN) },
    { periodEnd: '2024-01-01' },
    { changeAt: '2023-12-31' },
    { changeAt: '2024-02-02' },
    { method: 'fixed' },
    { method: 'fixed', fixedDays: 0 },
    { method: 'fixed', fixedDays: 401 },
    { method: 'fixed', fixedDays: 30.5 },
    { fixedDays: 30 },
    { method: 'calendar' },
    { rounding: 'nearest' },
  ]) {
    assert.throws(
      () => prorate({ ...ok, ...patch }),
      ProrationError,
      JSON.stringify(patch, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)),
    );
  }
  assert.throws(() => prorate(null), ProrationError);
  assert.throws(() => addMonthsClamped('2024-01-31', 1.5), ProrationError);
  assert.throws(() => addMonthsClamped('2024-01-31', 1, 32), ProrationError);
  assert.throws(
    () => addMonthsClamped('9999-12-31', 1),
    (e) => e.code === 'out-of-range',
  );
  assert.throws(() => planChange({ ...ok, oldPriceCents: 1n }), ProrationError);
});

test('CJS build agrees with ESM', () => {
  const cjs = createRequire(import.meta.url)('@lp-labs/subscription-proration');
  assert.equal(cjs.addMonthsClamped('2024-01-31', 1), '2024-02-29');
  assert.equal(
    cjs.prorate({
      ...{ priceCents: 2900n, periodStart: '2024-02-01', periodEnd: '2024-03-01' },
      changeAt: '2024-02-16',
    }).amountCents,
    1400n,
  );
});
