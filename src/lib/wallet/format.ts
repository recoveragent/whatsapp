/** Format paise as INR with 2 decimal places. */
export function formatInrFromPaise(paise: number): string {
  const rupees = (Number(paise) || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Parse rupee string (e.g. "100.50") to paise integer. */
export function rupeesToPaise(value: string | number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Compute GST amount in paise from base paise and rate (default 18%). */
export function computeGstPaise(basePaise: number, gstRate = 0.18): number {
  return Math.round(basePaise * gstRate);
}

export function formatDateInr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
