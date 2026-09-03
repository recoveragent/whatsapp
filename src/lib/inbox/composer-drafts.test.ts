import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "./composer-drafts";

const STORAGE_KEY = "wacrm:inbox:composer-drafts";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: createLocalStorageMock(),
    configurable: true,
  });
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("composer-drafts", () => {
  it("returns empty string when no draft exists", () => {
    expect(loadComposerDraft("conv-1")).toBe("");
  });

  it("saves and loads a draft per conversation", () => {
    saveComposerDraft("conv-1", "Hello Farooq");
    saveComposerDraft("conv-2", "Hi there");

    expect(loadComposerDraft("conv-1")).toBe("Hello Farooq");
    expect(loadComposerDraft("conv-2")).toBe("Hi there");
  });

  it("removes the entry when text is cleared", () => {
    saveComposerDraft("conv-1", "draft");
    clearComposerDraft("conv-1");

    expect(loadComposerDraft("conv-1")).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{}");
  });

  it("overwrites an existing draft for the same conversation", () => {
    saveComposerDraft("conv-1", "first");
    saveComposerDraft("conv-1", "second");

    expect(loadComposerDraft("conv-1")).toBe("second");
  });
});
