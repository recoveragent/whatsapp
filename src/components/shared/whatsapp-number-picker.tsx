'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';

export interface WhatsAppNumberOption {
  id: string;
  reference_name: string;
  phone_number_id: string;
  display_phone_number?: string | null;
  connected?: boolean;
  is_default?: boolean;
}

export function WhatsAppNumberPicker({
  value,
  onChange,
  id = 'whatsapp-number',
  label = 'From WhatsApp number',
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
}) {
  const [numbers, setNumbers] = useState<WhatsAppNumberOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/whatsapp/connection')
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ numbers?: WhatsAppNumberOption[] }>;
      })
      .then((data) => {
        if (cancelled || !data?.numbers) return;
        const rows = data.numbers.filter((number) => number.connected);
        setNumbers(rows);
        if (!value && rows[0]) onChange(rows[0].id);
      })
      .catch(() => {
        // The surrounding action will show its normal error if no sender can be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [onChange, value]);

  if (numbers.length <= 1) return null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm"
      >
        {numbers.map((number) => (
          <option key={number.id} value={number.id}>
            {number.reference_name} (
            {number.display_phone_number || number.phone_number_id})
            {number.is_default ? ' — Default' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
