// Determine direction without converting decimal money to a floating-point number.
export function moneySign(value: string): -1 | 0 | 1 {
  if (!/[1-9]/.test(value)) return 0;
  return value.startsWith('-') ? -1 : 1;
}
