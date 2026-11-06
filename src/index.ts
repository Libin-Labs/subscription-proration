export type RoundingMode = 'floor' | 'ceil' | 'half-even' | 'half-up' | 'trunc';
/** A UTC calendar day as a Date (time of day ignored) or a `YYYY-MM-DD` string. */
export type DayInput = Date | string;

export interface ProrationInput {
  readonly priceCents: bigint | number;
  readonly periodStart: DayInput;
  /** Exclusive end of the billing period. */
  readonly periodEnd: DayInput;
  /** First day on which the change applies; it must lie within [periodStart, periodEnd]. */
  readonly changeAt: DayInput;
  /** `actual` divides by the real period length; `fixed` divides by `fixedDays`. Default `actual`. */
  readonly method?: 'actual' | 'fixed';
  /** Required, and only allowed, for `fixed`. */
  readonly fixedDays?: number;
  /** Defaults to `half-even`. */
  readonly rounding?: RoundingMode;
}

export interface Proration {
  readonly totalDays: number;
  readonly remainingDays: number;
  /** Days actually charged: remaining days, capped at fixedDays for the fixed method. */
  readonly chargedDays: number;
  readonly divisorDays: number;
  readonly amountCents: bigint;
}

export interface PlanChangeInput extends Omit<ProrationInput, 'priceCents'> {
  readonly oldPriceCents: bigint | number;
  readonly newPriceCents: bigint | number;
}

export interface PlanChange {
  /** Credit for the unused part of the old plan. */
  readonly creditCents: bigint;
  /** Charge for the remaining part of the new plan. */
  readonly chargeCents: bigint;
  /** charge - credit; negative means the customer is owed money. */
  readonly netCents: bigint;
  readonly remainingDays: number;
  readonly totalDays: number;
}

export interface BillingPeriod {
  readonly index: number;
  readonly start: string;
  /** Exclusive. */
  readonly end: string;
  readonly days: number;
}

export type ProrationErrorCode = 'invalid-input' | 'out-of-range';

export class ProrationError extends Error {
  readonly code: ProrationErrorCode;
  constructor(code: ProrationErrorCode, message: string) {
    super(message);
    this.name = 'ProrationError';
    this.code = code;
  }
}

export const MAX_FIXED_DAYS = 400;
export const MAX_MONTHS = 120000;
const MODES: readonly RoundingMode[] = ['floor', 'ceil', 'half-even', 'half-up', 'trunc'];
const DAY_MS = 86_400_000;

function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const away = n < 0n ? q - 1n : q + 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case 'trunc':
      return q;
    case 'floor':
      return n < 0n ? away : q;
    case 'ceil':
      return n < 0n ? q : away;
    case 'half-up':
      return twice >= d ? away : q;
    case 'half-even':
      return twice > d || (twice === d && q % 2n !== 0n) ? away : q;
  }
}

/** Days since 1970-01-01 for a proleptic Gregorian civil date. */
function civilToDays(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

interface Civil {
  y: number;
  m: number;
  d: number;
}

function parseCivil(value: unknown, name: string): Civil {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new ProrationError('invalid-input', `${name} is an invalid Date.`);
    return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);
      if (y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) return { y, m, d };
    }
  }
  throw new ProrationError('invalid-input', `${name} must be a valid Date or YYYY-MM-DD string.`);
}

function toDays(value: unknown, name: string): number {
  const c = parseCivil(value, name);
  return civilToDays(c.y, c.m, c.d);
}

function format(days: number): string {
  const date = new Date(days * DAY_MS);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  return `${y}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function money(value: unknown, name: string): bigint {
  let result: bigint;
  if (typeof value === 'bigint') result = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) result = BigInt(value);
  else throw new ProrationError('invalid-input', `${name} must be a bigint or safe integer.`);
  if (result < 0n) throw new ProrationError('invalid-input', `${name} must not be negative.`);
  return result;
}

function shiftMonths(c: Civil, months: number, anchorDay: number): number {
  const index = c.y * 12 + (c.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return civilToDays(y, m, Math.min(anchorDay, daysInMonth(y, m)));
}

/**
 * Adds calendar months. The day of month is `anchorDay` (default: the date's own day), clamped to the
 * length of the target month, so Jan 31 + 1 month is Feb 28/29 and, with the anchor kept, Mar 31 later.
 */
export function addMonthsClamped(date: DayInput, months: number, anchorDay?: number): string {
  if (!Number.isInteger(months) || Math.abs(months) > MAX_MONTHS) {
    throw new ProrationError('invalid-input', `months must be an integer within ±${MAX_MONTHS}.`);
  }
  const c = parseCivil(date, 'date');
  const anchor = anchorDay ?? c.d;
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) {
    throw new ProrationError('invalid-input', 'anchorDay must be an integer from 1 to 31.');
  }
  const days = shiftMonths(c, months, anchor);
  const year = new Date(days * DAY_MS).getUTCFullYear();
  if (year < 1 || year > 9999)
    throw new ProrationError('out-of-range', 'Result year is outside 1 to 9999.');
  return format(days);
}

/** Whole days from `from` to `to` (negative if `to` is earlier), by UTC calendar day. */
export function daysBetween(from: DayInput, to: DayInput): number {
  return toDays(to, 'to') - toDays(from, 'from');
}

/**
 * The monthly billing period containing `at`, for a subscription whose cycle starts on `anchor`.
 * Periods are half-open: [start, end). Short months clamp the anchor day but later periods return to it.
 */
export function billingPeriod(anchor: DayInput, at: DayInput): BillingPeriod {
  const a = parseCivil(anchor, 'anchor');
  const target = toDays(at, 'at');
  const anchorDays = civilToDays(a.y, a.m, a.d);
  if (target < anchorDays) throw new ProrationError('out-of-range', 'at is before the anchor.');
  const t = new Date(target * DAY_MS);
  let k = (t.getUTCFullYear() - a.y) * 12 + (t.getUTCMonth() + 1 - a.m);
  if (shiftMonths(a, k, a.d) > target) k -= 1;
  if (k < 0 || k > MAX_MONTHS)
    throw new ProrationError('out-of-range', 'at is too far from the anchor.');
  const start = shiftMonths(a, k, a.d);
  const end = shiftMonths(a, k + 1, a.d);
  return { index: k, start: format(start), end: format(end), days: end - start };
}

export function prorate(input: ProrationInput): Proration {
  if (typeof input !== 'object' || input === null)
    throw new ProrationError('invalid-input', 'input must be an object.');
  const mode = input.rounding ?? 'half-even';
  if (!MODES.includes(mode)) throw new ProrationError('invalid-input', 'Unknown rounding mode.');
  const method = input.method ?? 'actual';
  if (method !== 'actual' && method !== 'fixed')
    throw new ProrationError('invalid-input', 'Unknown method.');
  const price = money(input.priceCents, 'priceCents');
  const start = toDays(input.periodStart, 'periodStart');
  const end = toDays(input.periodEnd, 'periodEnd');
  const at = toDays(input.changeAt, 'changeAt');
  if (end <= start)
    throw new ProrationError('invalid-input', 'periodEnd must be after periodStart.');
  if (at < start || at > end)
    throw new ProrationError('out-of-range', 'changeAt must lie within the period.');
  const total = end - start;
  const remaining = end - at;
  let divisor = total;
  let charged = remaining;
  if (method === 'fixed') {
    const fixed = input.fixedDays;
    if (fixed === undefined || !Number.isInteger(fixed) || fixed < 1 || fixed > MAX_FIXED_DAYS) {
      throw new ProrationError(
        'invalid-input',
        `fixed needs an integer fixedDays from 1 to ${MAX_FIXED_DAYS}.`,
      );
    }
    divisor = fixed;
    charged = Math.min(remaining, fixed);
  } else if (input.fixedDays !== undefined) {
    throw new ProrationError('invalid-input', 'fixedDays is only valid with method "fixed".');
  }
  const amount = divRound(price * BigInt(charged), BigInt(divisor), mode);
  return Object.freeze({
    totalDays: total,
    remainingDays: remaining,
    chargedDays: charged,
    divisorDays: divisor,
    amountCents: amount,
  });
}

export function planChange(input: PlanChangeInput): PlanChange {
  if (typeof input !== 'object' || input === null)
    throw new ProrationError('invalid-input', 'input must be an object.');
  const { oldPriceCents, newPriceCents, ...shared } = input;
  const credit = prorate({ ...shared, priceCents: oldPriceCents });
  const charge = prorate({ ...shared, priceCents: newPriceCents });
  return Object.freeze({
    creditCents: credit.amountCents,
    chargeCents: charge.amountCents,
    netCents: charge.amountCents - credit.amountCents,
    remainingDays: credit.remainingDays,
    totalDays: credit.totalDays,
  });
}
