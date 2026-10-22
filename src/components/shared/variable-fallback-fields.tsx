'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import {
  setVariableFallback,
  variableFallbacks,
} from '@/lib/flows/variable-fallback';

export function VariableFallbackFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return variableFallbacks(value).map(({ key, fallback }, index) => {
    const invalid = !fallback.trim() || fallback.includes('{{');
    const fieldId = `${id}-${index}`;
    return (
      <div key={key} className="min-w-0 space-y-1">
        <label
          htmlFor={fieldId}
          className="text-muted-foreground block text-xs"
        >
          Fallback for {key} <span className="text-destructive">*</span>
        </label>
        <Input
          id={fieldId}
          value={fallback}
          required
          aria-invalid={invalid}
          aria-describedby={invalid ? `${fieldId}-error` : undefined}
          placeholder="Value when empty (required)"
          onChange={(event) =>
            onChange(setVariableFallback(value, key, event.target.value))
          }
          className="bg-muted text-xs"
        />
        {invalid && (
          <p id={`${fieldId}-error`} className="text-destructive text-[10px]">
            Enter fallback text to use when this variable is empty.
          </p>
        )}
      </div>
    );
  });
}
