import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, MAX_OUTPUT_TOKENS, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import type { ProviderArgs } from './providers/shared'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  try {
    result = await callProvider(config.provider, providerArgs)
  } catch (err) {
    // Reasoning models spend part of the output budget thinking; on a
    // long prompt they can exhaust it and return no text at all. One
    // retry with a larger budget recovers those turns.
    if (!(err instanceof AiError) || err.code !== 'empty_response') throw err
    result = await callProvider(config.provider, {
      ...providerArgs,
      maxOutputTokens: RETRY_OUTPUT_TOKENS,
    })
  }

  return parseGeneration(result.text, result.usage)
}

/** Output budget for the single retry after an empty response. */
const RETRY_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS * 4

function callProvider(
  provider: AiConfig['provider'],
  args: ProviderArgs,
): Promise<{ text: string; usage: AiUsage | null }> {
  switch (provider) {
    case 'openai':
      return generateOpenAi(args)
    case 'anthropic':
      return generateAnthropic(args)
    default:
      throw new AiError(`Unsupported AI provider: ${provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
