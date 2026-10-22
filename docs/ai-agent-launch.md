# AI agent launch — 22 October 2026

Follow-up to the [14 October production audit](ai-agent-production-audit-2026-10-14.md), which rated the agent NO-GO: 32 of 50 test questions ended in an empty handoff. This change fixes the causes found in code, connects the agent to Flows, and adds a public page to advertise it.

Rollout is unchanged: a super admin still enables AI Agents per brand and sets the provider, model and key.

## Why answers were empty, and the fixes

| Cause | Fix |
| --- | --- |
| Keyword search used `plainto_tsquery`, which **ANDs every word**, filler included, so “What is your return policy?” only matched a chunk containing *what*, *is*, *your*, *return* and *policy*. Imported policies were rarely found, the prompt had no knowledge, and the model handed off. | Filler words (English plus romanised Hindi and Tamil) are stripped in `src/lib/ai/knowledge-query.ts`. The RPC now ORs the terms and ranks the results. A short follow-up such as “and for COD?” carries the previous question’s topic. Knowledge bases of 8 chunks or fewer are sent whole when the search finds nothing. |
| The prompt said “prefer handing off over guessing”, and nothing told the model what the store sells. | Handoff is now limited to specific cases: a request for a person, a problem the team must act on, an action the agent can’t perform, an angry customer, or a fact found nowhere in the prompt. A store profile (brand name, price range, a sample of catalog titles) answers “What do you sell?”. |
| A handoff sent the customer **nothing**. | The customer gets a handoff message, which the brand can edit in Setup (`ai_configs.handoff_message`). |
| A provider error or empty output (reasoning models can use up the output budget) was only logged, so the customer got silence. | One retry with 4× the output budget. If it still fails, the agent hands off, and the internal note gives the reason (e.g. “the AI provider rejected the API key”). |
| Any active `new_message_received` or `keyword_match` automation silenced the agent for the whole brand. | The agent stands down only when a message-level automation actually matched *this* message. |

## New

- **Flow step “Hand to AI agent”** (`ai_agent`). A final step that turns the agent back on for the chat, resets its reply limit and stores an optional goal (supports `{{ vars.* }}`). The goal is added to every AI reply's prompt until the agent hands off. If the customer's message is the latest one, the agent answers it right away. After store-event flows it waits for the customer's reply. The builder warns when AI Agents or auto-replies are off.
- **Flow templates:** *AI checkout recovery* (Shopify abandoned checkout → recovery template → AI agent with a recovery goal) and *AI shopping assistant* (shopping keywords → AI agent with a guided-selling goal).
- **Go-live checklist** on AI Agents covering: model, WhatsApp, Shopify, catalog, knowledge, instructions, Playground test, catch-all automations, auto-replies. It shows “Your AI agent is live” once every required item passes.
- **Playground** now uses the same store profile as live replies and shows the handoff message the customer would see.
- **Public landing page** at `/ai-agent`. It is indexable, and its **Get started** button goes to the Recover Agent dashboard SSO. Set `NEXT_PUBLIC_AI_AGENT_DEMO_URL` to also show **Book a demo**. Every claim on the page maps to shipped behaviour. Keep it that way.

## Deploy

1. Apply `supabase/migrations/20261022090000_ai_agent_launch.sql`. It replaces the lexical search function, adds `ai_configs.handoff_message` and `conversations.ai_flow_goal`, and allows the `ai_agent` node type. The code tolerates the new columns being missing, but search quality, handoff messages and the flow step need the migration.
2. Optional: set `NEXT_PUBLIC_AI_AGENT_DEMO_URL`.

## Before advertising: re-run the audit

The fixes are unit-tested. They have **not** been verified against a live model or a live WhatsApp number. Re-run the 50-question set from the audit on a connected test brand, then check on a real test number:

- policy, COD and shipping questions answered from imported policies
- “What do you sell?” answered from the store profile
- a handoff sends the handoff message, assigns the chat and notifies the agent
- the *AI checkout recovery* template: the reply to the recovery template is answered with the goal
- a keyword automation that does not match a message no longer silences the agent

Still open from the audit: verified order lookup for a known order, a different number or multiple orders; budget enforcement for Tamil and Tanglish phrasing; a Usage tab entry for Playground calls.
