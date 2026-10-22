import type { ChatMessage } from './types'

// ============================================================
// Turning a customer message into a knowledge-base search.
//
// The lexical RPC ORs every term it is given (migration
// 20261022090000), so filler words would match nearly every chunk and
// drown the ranking. These lists strip them first. They cover English
// plus the romanised Hindi/Tamil fillers Indian Shopify customers mix in.
// ============================================================

const STOPWORDS = new Set(
  (
    // English
    'a an the and or but if then so of to in on at by for from with about into over ' +
    'is am are was were be been being do does did doing done have has had having ' +
    'i me my mine we us our ours you your yours he him his she her it its they them their ' +
    'this that these those there here what which who whom whose when where why how ' +
    'can could will would shall should may might must need want wanted like ' +
    'please pls plz kindly hi hello hey hii thanks thank thx ok okay yes no not ' +
    'just also too very really any some all much many more most get got give tell ' +
    'know let make send show see check help u ur im ive dont cant wont ' +
    // Romanised Hindi
    'kya hai hain ka ki ke ko se me mein mujhe mera meri mere aap aapka aapki ' +
    'hum ham tum ye yeh wo woh kaise kab kahan kitna kitne kitni bhai bhaiya ji haan ' +
    'chahiye karo kar karna batao bataye dijiye diya hota hoga raha rahe rahi tha thi ' +
    // Romanised Tamil
    'enna enga eppo epdi la ku pannunga sollunga vendum venum irukka iruka'
  ).split(/\s+/)
)

/** Keywords worth searching for: lowercased, de-duplicated, filler removed. */
export function knowledgeKeywords(text: string): string[] {
  const seen = new Set<string>()
  // \p{M} keeps combining vowel signs (Tamil, Devanagari) inside words.
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!raw || STOPWORDS.has(raw)) continue
    // Single Latin letters/digits are noise; a single non-Latin
    // character (e.g. a CJK word) can carry meaning, so keep those.
    if (raw.length < 2 && /^[a-z0-9]$/.test(raw)) continue
    seen.add(raw)
  }
  return [...seen]
}

/**
 * The text to search the knowledge base with for the current turn.
 *
 * Usually the latest customer message. When that message carries fewer
 * than two keywords ("and for COD?", "how long?") the previous customer
 * message is prepended so the follow-up keeps its topic.
 */
export function knowledgeSearchText(messages: ChatMessage[]): string {
  const userTurns = messages.filter((m) => m.role === 'user').map((m) => m.content)
  const latest = userTurns.at(-1) ?? ''
  if (knowledgeKeywords(latest).length >= 2 || userTurns.length < 2) return latest
  return `${userTurns.at(-2)}\n${latest}`
}
