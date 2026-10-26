'use client';

import { useId, type ComponentType } from 'react';
import { Input } from '@/components/ui/input';
import {
  setVariableFallback,
  variableFallbacks,
} from '@/lib/flows/variable-fallback';

export interface FallbackInputProps {
  id: string;
  fallback: string;
  invalid: boolean;
  onChange: (fallback: string) => void;
}

export function VariableFallbackFields({
  value,
  onChange,
  FallbackInput,
  invalidMessage = 'Enter fallback text to use when this variable is empty.',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Replaces the text box, e.g. with an image upload for media headers.
   *  Rendered as a component (not called) so its hooks stay its own. */
  FallbackInput?: ComponentType<FallbackInputProps>;
  invalidMessage?: string;
}) {
  const id = useId();
  return variableFallbacks(value).map(({ key, fallback }, index) => {
    const invalid = !fallback.trim() || fallback.includes('{{');
    const fieldId = `${id}-${index}`;
    const setFallback = (next: string) =>
      onChange(setVariableFallback(value, key, next));
    return (
      <div key={key} className="min-w-0 space-y-1">
        <label
          htmlFor={fieldId}
          className="text-muted-foreground block text-xs"
        >
          Fallback for {key} <span className="text-destructive">*</span>
        </label>
        {FallbackInput ? (
          <FallbackInput
            id={fieldId}
            fallback={fallback}
            invalid={invalid}
            onChange={setFallback}
          />
        ) : (
          <Input
            id={fieldId}
            value={fallback}
            required
            aria-invalid={invalid}
            aria-describedby={invalid ? `${fieldId}-error` : undefined}
            placeholder="Value when empty (required)"
            onChange={(event) => setFallback(event.target.value)}
            className="bg-muted text-xs"
          />
        )}
        {invalid && (
          <p id={`${fieldId}-error`} className="text-destructive text-[10px]">
            {invalidMessage}
          </p>
        )}
      </div>
    );
  });
}
