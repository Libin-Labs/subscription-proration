import { addMonthsClamped, daysBetween, ProrationError } from '@lp-labs/subscription-proration';

const next: string = addMonthsClamped('2024-01-31', 1);
const days: number = daysBetween('2024-01-01', '2024-03-01');
const code: string = new ProrationError('invalid-input', 'x').code;
void [next, days, code];
