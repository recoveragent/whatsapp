'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';

export function ChannelSelector() {
  const { channels, activeChannel, channelError } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(channelId: string) {
    if (!channelId || channelId === activeChannel?.id) return;
    setSwitching(true);
    window.dispatchEvent(new Event('wacrm:channel-switch-start'));
    setError(null);
    try {
      const response = await fetch('/api/whatsapp/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not switch channel.');
      // A document navigation discards selections, cached queries, deep-linked
      // records and running UI subscriptions from the previous workspace.
      window.location.replace(result.nextUrl ?? '/inbox');
    } catch (failure) {
      window.dispatchEvent(new Event('wacrm:channel-switch-failed'));
      setError(failure instanceof Error ? failure.message : 'Could not switch channel.');
      setSwitching(false);
    }
  }

  if (!channels.length) return null;
  return (
    <div className="min-w-0 max-w-xs">
      <label htmlFor="active-whatsapp-channel" className="block text-xs text-muted-foreground">WhatsApp channel</label>
      <select id="active-whatsapp-channel" value={activeChannel?.id ?? ''}
        disabled={switching || Boolean(channelError)} onChange={(event) => void select(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        aria-busy={switching}>
        {!activeChannel && <option value="" disabled>Select a channel</option>}
        {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
