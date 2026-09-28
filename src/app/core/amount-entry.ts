const small = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n: bigint, indian: boolean): string {
  if (n < 20n) return small[Number(n)];
  if (n < 100n) return tens[Number(n / 10n)] + (n % 10n ? ' ' + words(n % 10n, indian) : '');
  const scales: [bigint, string][] = indian
    ? [
        [10000000n, 'crore'],
        [100000n, 'lakh'],
        [1000n, 'thousand'],
        [100n, 'hundred'],
      ]
    : [
        [1000000000000n, 'trillion'],
        [1000000000n, 'billion'],
        [1000000n, 'million'],
        [1000n, 'thousand'],
        [100n, 'hundred'],
      ];
  for (const [size, name] of scales)
    if (n >= size)
      return words(n / size, indian) + ' ' + name + (n % size ? ' ' + words(n % size, indian) : '');
  return '';
}
export function formatAmount(raw: string, currency: string): string {
  if (!/^\d*(\.\d*)?$/.test(raw)) return raw;
  const [whole, fraction] = raw.split('.');
  const grouped =
    currency === 'INR'
      ? whole.replace(/\B(?=(\d{2})*\d{3}(?!\d))/g, ',')
      : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return grouped + (fraction === undefined ? '' : '.' + fraction);
}
export function amountWords(raw: string, currency: string): string {
  if (!/^\d+(\.\d{0,4})?$/.test(raw) || raw.length > 24) return '';
  const [whole, fraction] = raw.split('.');
  const names: Record<string, string> = {
    INR: 'rupees',
    MYR: 'ringgit',
    USD: 'US dollars',
    EUR: 'euros',
    GBP: 'pounds',
    JPY: 'yen',
  };
  let result = words(BigInt(whole), currency === 'INR');
  if (fraction && /[1-9]/.test(fraction))
    result += ' point ' + [...fraction].map((n) => small[Number(n)]).join(' ');
  result += ' ' + (names[currency] || currency);
  return result[0].toUpperCase() + result.slice(1);
}
