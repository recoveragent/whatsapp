'use client';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type Confirm = { title: string; body: ReactNode; action: string; destructive?: boolean; run: () => Promise<void> };

/** In-app confirmation. Stays open with the reason when the action fails. */
export function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await confirm.run(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogTitle>{confirm.title}</DialogTitle>
        <DialogDescription render={<div />} className="space-y-3">{confirm.body}</DialogDescription>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={confirm.destructive ? 'destructive' : 'default'} onClick={() => void go()} disabled={busy}>{busy ? 'Please wait' : confirm.action}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
