"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FlowEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Flow editor render error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <div className="space-y-1">
        <h1 className="text-base font-semibold text-foreground">
          Couldn&apos;t open this flow
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Something went wrong while rendering the editor. Try reloading, or
          go back to the flows list.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>Reload</Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          Back
        </Button>
      </div>
    </div>
  );
}
