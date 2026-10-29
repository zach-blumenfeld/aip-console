// The Studio's autosave: one Draft in localStorage. Every read and write is best effort, as in a private window
// or with site data blocked the page still works and only loses the draft on reload.

import { emptyDraft, type Draft } from "./draft";

export const DRAFT_KEY = "aip-console:studio:draft";

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d && Array.isArray(d.steps) && Array.isArray(d.triggerWhen)) return d;
    }
  } catch { /* an unreadable draft is a blank one */ }
  return emptyDraft();
}

/** True when the write went through. */
export function saveDraft(draft: Draft): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
