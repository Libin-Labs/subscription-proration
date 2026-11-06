import {
  billingPeriod,
  planChange,
  prorate,
  type BillingPeriod,
  type PlanChange,
} from '@lp-labs/subscription-proration';

const period: BillingPeriod = billingPeriod('2024-01-31', new Date(Date.UTC(2024, 1, 29)));
const change: PlanChange = planChange({
  oldPriceCents: 1000n,
  newPriceCents: 2000n,
  periodStart: period.start,
  periodEnd: period.end,
  changeAt: period.end,
});
const cents: bigint = prorate({
  priceCents: 3000,
  periodStart: '2024-01-01',
  periodEnd: '2024-02-01',
  changeAt: '2024-01-16',
  method: 'fixed',
  fixedDays: 30,
}).amountCents;
void [change.netCents, cents];
