export interface PipelineOption {
  id: string;
  name: string;
}

export interface StageOption {
  id: string;
  pipeline_id: string;
  name: string;
}

export function resolvePipelineLabel(
  pipelineId: string,
  pipelines: PipelineOption[] = [],
  options?: { loading?: boolean },
): string {
  if (!pipelineId) return "";
  const match = pipelines.find((pipeline) => pipeline.id === pipelineId);
  if (match) return match.name;
  if (options?.loading) return "Loading…";
  return "Unknown pipeline";
}

export function resolveStageLabel(
  stageId: string,
  stages: StageOption[] = [],
  options?: { loading?: boolean },
): string {
  if (!stageId) return "";
  const match = stages.find((stage) => stage.id === stageId);
  if (match) return match.name;
  if (options?.loading) return "Loading…";
  return "Unknown stage";
}
