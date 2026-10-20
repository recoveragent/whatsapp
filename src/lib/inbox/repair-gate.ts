/** Component-local: coalesce repair scans without suppressing history refreshes. */
export function createRepairGate(now = Date.now, cooldownMs = 60_000) {
  const entries = new Map<string, { pending: boolean; finishedAt: number }>();
  return {
    start(key: string) {
      const previous = entries.get(key);
      if (
        previous &&
        (previous.pending || now() - previous.finishedAt < cooldownMs)
      )
        return false;
      // Bound memory without evicting a running repair.
      if (entries.size >= 20) {
        for (const [id, entry] of entries) {
          if (!entry.pending) {
            entries.delete(id);
            break;
          }
        }
      }
      entries.set(key, { pending: true, finishedAt: 0 });
      return true;
    },
    finish(key: string, succeeded: boolean) {
      if (succeeded) entries.set(key, { pending: false, finishedAt: now() });
      else entries.delete(key);
    },
  };
}
