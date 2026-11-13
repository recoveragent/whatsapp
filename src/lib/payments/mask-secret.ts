/** Display a saved credential without returning it to the browser. */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  return secret.length > 2 ? `********${secret.slice(-2)}` : '********';
}
