"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { PipelineOption, StageOption } from "@/lib/pipelines";

export function useAccountPipelines(): {
  pipelines: PipelineOption[];
  stages: StageOption[];
  loaded: boolean;
} {
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      try {
        const [pipesRes, stagesRes] = await Promise.all([
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, pipeline_id, name")
            .order("position"),
        ]);
        if (cancelled) return;
        setPipelines((pipesRes.data as PipelineOption[] | null) ?? []);
        setStages((stagesRes.data as StageOption[] | null) ?? []);
      } catch {
        // Pipelines unavailable — caller falls back to raw ids.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { pipelines, stages, loaded };
}
