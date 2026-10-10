// Salary range read straight from the posting text: a pattern match, never a model guess,
// so the popup only ever shows pay the posting itself states. Returns null when none is given.

const CURRENCY = { '$': 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR', USD: 'USD', CAD: 'CAD', GBP: 'GBP', EUR: 'EUR', INR: 'INR', AUD: 'AUD' };
const SYMBOL = { USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', INR: '₹', AUD: 'A$' };

// One amount: optional currency, a number with commas or decimals, optional k (thousands).
const AMOUNT = String.raw`(?:(USD|CAD|GBP|EUR|INR|AUD)\s?)?([$£€₹])?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?![\d,]*\s?(?:[mMbB](?:illion)?\b|%|\+))`;
const RANGE = new RegExp(`${AMOUNT}\\s?(?:-|–|—|to)\\s?${AMOUNT}(?:\\s?(USD|CAD|GBP|EUR|INR|AUD))?`, 'g');
const SINGLE = new RegExp(AMOUNT, 'g');
const PAY_WORDS = /salary|compensation|pay range|pay rate|base pay|hourly rate|wage|\bpay\b|\bOTE\b/i;
const PERIOD = [
  [/per hour|\/\s?h(ou)?r\b|hourly|an hour/i, 'hour'],
  [/per month|\/\s?mo(nth)?\b|monthly|a month/i, 'month'],
  [/per year|\/\s?y(ea)?r\b|annual|annually|a year|per annum|p\.a\./i, 'year'],
];

function toNumber(num, k) {
  const n = Number(String(num).replace(/,/g, ''));
  return k ? n * 1000 : n;
}

function periodNear(text, at, len) {
  const around = text.slice(at, at + len + 40);
  for (const [re, p] of PERIOD) if (re.test(around)) return p;
  return null;
}

// Plausible pay for its period, so funding rounds, team sizes and years are skipped.
function plausible(min, max, period) {
  if (!(min > 0) || !(max >= min)) return false;
  if (period === 'hour') return min >= 7 && max <= 1000;
  if (period === 'month') return min >= 500 && max <= 100000;
  return min >= 10000 && max <= 2000000;
}

function format(n, currency) {
  const sym = SYMBOL[currency] || `${currency} `;
  return `${sym}${Math.round(n).toLocaleString('en-US')}`;
}

function build(min, max, currency, period, raw) {
  const per = period === 'hour' ? ' per hour' : period === 'month' ? ' per month' : ' per year';
  const range = min === max ? format(min, currency) : `${format(min, currency)} to ${format(max, currency)}`;
  return { min, max, currency, period, text: `${range}${per}`, source: raw.trim() };
}

function extractSalary(text) {
  if (!text) return null;
  const t = String(text);

  // 1. A range with a currency marker anywhere in it ("$120,000 - $150,000", "USD 90k to 110k").
  for (const m of t.matchAll(RANGE)) {
    const [raw, code1, sym1, n1, k1, code2, sym2, n2, k2, codeAfter] = m;
    const cur = CURRENCY[code1 || sym1 || code2 || sym2 || codeAfter];
    if (!cur) continue;
    // "90k-110k" means both ends are thousands even if only one carries the k.
    const k = k1 || k2;
    let min = toNumber(n1, k1 || (k2 && Number(n1) < 1000 ? k : null));
    let max = toNumber(n2, k2 || (k1 && Number(n2) < 1000 ? k : null));
    const period = periodNear(t, m.index, raw.length) || (max < 1000 ? 'hour' : 'year');
    if (plausible(min, max, period)) return build(min, max, cur, period, raw);
  }

  // 2. A single amount, only when pay words sit right before it ("Base salary: $135,000").
  for (const m of t.matchAll(SINGLE)) {
    const [raw, code, sym, n, k] = m;
    const cur = CURRENCY[code || sym];
    if (!cur) continue;
    if (!PAY_WORDS.test(t.slice(Math.max(0, m.index - 60), m.index))) continue;
    const amount = toNumber(n, k);
    const period = periodNear(t, m.index, raw.length) || (amount < 1000 ? 'hour' : 'year');
    if (plausible(amount, amount, period)) return build(amount, amount, cur, period, raw);
  }
  return null;
}

module.exports = { extractSalary };
