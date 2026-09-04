"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { slugify } from "./shared";

interface NodeKeyFieldProps {
  nodeKey: string;
  /** Returns the committed key on success, or null when rename is rejected. */
  onRename: (newKey: string) => string | null;
  className?: string;
}

export function NodeKeyField({
  nodeKey,
  onRename,
  className,
}: NodeKeyFieldProps) {
  const [draft, setDraft] = useState(nodeKey);

  useEffect(() => {
    setDraft(nodeKey);
  }, [nodeKey]);

  const commit = () => {
    const cleaned = slugify(draft, nodeKey);
    if (cleaned === nodeKey) {
      setDraft(nodeKey);
      return;
    }
    const result = onRename(cleaned);
    setDraft(result ?? nodeKey);
  };

  return (
    <div className={className}>
      <label className="mb-1 block text-xs text-muted-foreground">
        Node name
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(nodeKey);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="bg-muted font-mono text-xs"
      />
    </div>
  );
}
