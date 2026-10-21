'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  normalizeDirectSendStatus,
  type DirectSendStatus,
} from '@/lib/whatsapp/direct-send';

export function DirectSendSettings({
  brandId,
  canEdit = false,
}: {
  brandId?: string;
  canEdit?: boolean;
}) {
  const endpoint = brandId
    ? `/api/admin/brands/${brandId}/whatsapp/direct-send`
    : '/api/whatsapp/direct-send';
  const [configId, setConfigId] = useState<string | null>(null);
  const [status, setStatus] = useState<DirectSendStatus>('unknown');
  const [selected, setSelected] = useState<DirectSendStatus>('unknown');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setConfigId(null);
    fetch(endpoint, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok)
          throw new Error(
            data.error || 'Could not load Direct Send availability'
          );
        if (!cancelled) {
          setConfigId(data.config_id);
          setStatus(normalizeDirectSendStatus(data.status));
          setSelected(normalizeDirectSendStatus(data.status));
          setConfirmed(false);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: configId,
          status: selected,
          meta_access_confirmed: confirmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save availability');
      setStatus(normalizeDirectSendStatus(data.status));
      setConfirmed(false);
      toast.success('Direct Send availability saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save availability'
      );
    } finally {
      setSaving(false);
    }
  };
  if (!configId && !error) return null;
  return (
    <div className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Direct Send</span>
        <span className="text-muted-foreground">
          {status === 'enabled'
            ? 'Enabled · access confirmed'
            : status === 'unavailable'
              ? 'Unavailable'
              : 'Unknown · access not confirmed'}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        Meta controls access for each WhatsApp Business Account. Confirm
        eligibility in WhatsApp Manager or with Meta support. This setting
        records access; it does not activate the feature at Meta.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {canEdit && configId && (
        <>
          <label className="flex items-center gap-3 text-xs">
            Availability
            <select
              value={selected}
              disabled={saving}
              onChange={(e) => {
                setSelected(e.target.value as DirectSendStatus);
                setConfirmed(false);
              }}
              className="border-border bg-background rounded-md border px-2 py-1.5"
            >
              <option value="unknown">Unknown</option>
              <option value="enabled">Enabled</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
          {selected === 'enabled' && (
            <label className="text-muted-foreground flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={saving}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirmed that Meta has enabled Direct Send for this connected
              WhatsApp account.
            </label>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={
              saving ||
              selected === status ||
              (selected === 'enabled' && !confirmed)
            }
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save availability'}
          </Button>
        </>
      )}
    </div>
  );
}
