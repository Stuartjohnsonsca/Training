/** Format a number as £x,xxx.xx (UK locale, 2dp). */
export function formatGBP(n: number): string {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format a number with comma thousand separators, no currency. */
export function formatNumber(n: number, dp = 2): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
