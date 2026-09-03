const STORAGE_KEY = "wacrm:inbox:composer-drafts";

type DraftStore = Record<string, string>;

function readStore(): DraftStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const store: DraftStore = {};
    for (const [id, text] of Object.entries(parsed)) {
      if (typeof text === "string") store[id] = text;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: DraftStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Persistence is best-effort; ignore storage failures.
  }
}

/** Load unsent reply text for a conversation. */
export function loadComposerDraft(conversationId: string): string {
  return readStore()[conversationId] ?? "";
}

/** Persist unsent reply text; empty string removes the entry. */
export function saveComposerDraft(conversationId: string, text: string): void {
  const store = readStore();
  if (!text) {
    delete store[conversationId];
  } else {
    store[conversationId] = text;
  }
  writeStore(store);
}

/** Remove a conversation's saved draft (e.g. after send). */
export function clearComposerDraft(conversationId: string): void {
  saveComposerDraft(conversationId, "");
}
