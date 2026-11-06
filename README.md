# @lp-labs/subscription-proration

Calendar-aware proration for recurring monthly billing, in exact bigint cents. Works on UTC calendar
days, finds half-open monthly billing periods that survive short months, and prorates by actual days
or by a fixed day count you choose.

## Install

```bash
npm install @lp-labs/subscription-proration
```

ES2022 ESM and CommonJS builds ship with TypeScript declarations. There are no runtime dependencies.

## Quickstart

```js
import { billingPeriod, planChange, prorate } from '@lp-labs/subscription-proration';

const period = billingPeriod('2024-01-31', '2024-02-10');
console.log(period); // { index: 0, start: '2024-01-31', end: '2024-02-29', days: 29 }

const credit = prorate({
  priceCents: 2900n,
  periodStart: '2024-02-01',
  periodEnd: '2024-03-01',
  changeAt: '2024-02-16',
});
if (credit.amountCents !== 1400n) throw new Error('unexpected proration'); // 14 of 29 days

const change = planChange({
  oldPriceCents: 3000n,
  newPriceCents: 6000n,
  periodStart: '2024-04-01',
  periodEnd: '2024-05-01',
  changeAt: '2024-04-11',
  method: 'fixed',
  fixedDays: 30,
});
console.log(change.netCents); // 2000n
```

## API

```ts
type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
type DayInput = Date | string; // UTC calendar day: Date (time ignored) or 'YYYY-MM-DD'
interface ProrationInput {
  priceCents: bigint | number;
  periodStart: DayInput;
  periodEnd: DayInput;
  changeAt: DayInput;
  method?: 'actual' | 'fixed';
  fixedDays?: number;
  rounding?: RoundingMode;
}
interface Proration {
  totalDays: number;
  remainingDays: number;
  chargedDays: number;
  divisorDays: number;
  amountCents: bigint;
}
interface PlanChangeInput extends Omit<ProrationInput, 'priceCents'> {
  oldPriceCents: bigint | number;
  newPriceCents: bigint | number;
}
interface PlanChange {
  creditCents: bigint;
  chargeCents: bigint;
  netCents: bigint;
  remainingDays: number;
  totalDays: number;
}
interface BillingPeriod {
  index: number;
  start: string;
  end: string;
  days: number;
}
type ProrationErrorCode = 'invalid-input' | 'out-of-range';
class ProrationError extends Error {
  readonly code: ProrationErrorCode;
}
const MAX_FIXED_DAYS: 400;
const MAX_MONTHS: 120000;
function addMonthsClamped(date: DayInput, months: number, anchorDay?: number): string;
function daysBetween(from: DayInput, to: DayInput): number;
function billingPeriod(anchor: DayInput, at: DayInput): BillingPeriod;
function prorate(input: ProrationInput): Proration;
function planChange(input: PlanChangeInput): PlanChange;
```

- Amounts are non-negative bigint cents (or safe integers). Rounding is one exact division,
  `price * chargedDays / divisorDays`, and defaults to `half-even` (ties go to the even cent, never a
  floating-point nearest).
- Periods are `[periodStart, periodEnd)`. `changeAt` may equal either end: at the start the whole price
  applies, at the end nothing remains.
- `actual` divides by the real length of the period. `fixed` divides by `fixedDays` and charges
  `min(remaining, fixedDays)` days, so a 31-day month never charges more than the full price.
  `fixedDays` is rejected with `actual`, and required with `fixed`.
- `billingPeriod` keeps the anchor day: with an anchor of the 31st the periods run
  Jan 31 - Feb 29 - Mar 31 - Apr 30 and so on.
- `addMonthsClamped` clamps to the target month's length; pass `anchorDay` to return to a day later.
- `planChange` credits unused old time and charges remaining new time, each rounded separately;
  `netCents` is charge minus credit (negative when money is owed to the customer).

## Customization

Choose the method, fixed day count, and rounding mode per call. Currency and tax are yours to handle.

## Errors

`ProrationError` (`invalid-input`, `out-of-range`) for malformed dates, amounts, ranges, and conflicting
options.

## Performance

Constant time per call apart from `billingPeriod`, which does a bounded month estimate.

## Honest scope

Dates are treated as UTC calendar days only. There is no time of day, daylight-saving, or time-zone
handling: convert to the calendar day you bill on before calling. It does not model trials, taxes,
invoicing rules, refunds policy, or legal requirements.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
