import { useEffect, useRef, useState } from 'react';
import { matrixRegionDraft, normalizeMatrixTargetPlatform } from '../../shared/matrix-requirements';

export interface MatrixFormDraft {
  product: string; industry: string; audience: string; questions: string;
  regions: string; hours: string; assetKind: string; samplePlatform: string; brandData: string;
  regionsUnrestricted?: boolean; targetPlatform?: string;
  currency: string; total: string; exploration: string; enabled: boolean; min: string; max: string;
}
interface Entry { values: MatrixFormDraft; edited: boolean; persisted: boolean; restored: boolean; touched: Set<keyof MatrixFormDraft> }
const drafts = new WeakMap<object, Map<string, Entry>>();
const prefix = 'frontmind.matrix.form.v1:';
function normalizeDraft(values: MatrixFormDraft): MatrixFormDraft {
  return { ...values, ...matrixRegionDraft(values.regions, values.regionsUnrestricted), targetPlatform: normalizeMatrixTargetPlatform(values.targetPlatform) };
}

function readDraft(key: string, defaults: MatrixFormDraft): MatrixFormDraft | undefined {
  try {
    const raw = sessionStorage.getItem(prefix + key);
    if (!raw || raw.length > 40_000) return;
    const record = JSON.parse(raw) as { savedAt?: number; values?: Record<string, unknown> };
    if (!record.savedAt || Date.now() - record.savedAt > 86_400_000 || !record.values) return;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof MatrixFormDraft>) {
      const value = record.values[key];
      // v1 drafts predate both independent target and the explicit empty-region state.
      if (key === 'targetPlatform' || key === 'regionsUnrestricted') continue;
      if (key === 'enabled') { if (typeof value !== 'boolean') return; result.enabled = value; }
      else { if (typeof value !== 'string' || value.length > 12_000) return; result[key] = value; }
    }
    result.targetPlatform = typeof record.values.targetPlatform === 'string' && record.values.targetPlatform.length <= 80 ? record.values.targetPlatform : '';
    result.regionsUnrestricted = typeof record.values.regionsUnrestricted === 'boolean' ? record.values.regionsUnrestricted : undefined;
    return normalizeDraft(result);
  } catch { return; }
}

/** Preserve ancillary choices without mixing them into AI output. Browser storage
 * is used only after the server supplied an authenticated scope identity. */
export function useMatrixFormDraft(owner: object, scope: string, defaults: MatrixFormDraft, persistentKey?: string, pendingScope?: string) {
  const [, render] = useState(0);
  let entries = drafts.get(owner);
  if (!entries) { entries = new Map(); drafts.set(owner, entries); }
  let entry = entries.get(scope);
  if (!entry) {
    const saved = persistentKey ? readDraft(persistentKey, defaults) : undefined;
    const pending = pendingScope && pendingScope !== scope ? entries.get(pendingScope) : undefined;
    const values = saved ?? normalizeDraft(defaults);
    if (pending?.edited) for (const key of pending.touched) Object.assign(values, { [key]: pending.values[key] });
    entry = { values, edited: Boolean(pending?.edited), persisted: Boolean(saved) && !pending?.edited, restored: Boolean(saved), touched: new Set(pending?.touched) };
    if (pending?.edited && pendingScope) entries.delete(pendingScope);
    entries.set(scope, entry);
    if (entries.size > 30) entries.delete(entries.keys().next().value!);
  } else if (pendingScope && pendingScope !== scope) {
    const pending = entries.get(pendingScope);
    if (pending?.edited) {
      entry.values = { ...entry.values };
      for (const key of pending.touched) { Object.assign(entry.values, { [key]: pending.values[key] }); entry.touched.add(key); }
      entry.edited = true;
      entry.persisted = false;
      entries.delete(pendingScope);
    }
  }
  const active = useRef({ owner, scope, entry, persistentKey });
  active.current = { owner, scope, entry, persistentKey };
  const captured = entry;
  // Edits made while the server confirms this page's identity must be saved
  // as soon as that verified key arrives, without requiring another edit.
  useEffect(() => {
    if (!persistentKey || !captured.edited || captured.persisted || active.current.entry !== captured) return;
    try {
      sessionStorage.setItem(prefix + persistentKey, JSON.stringify({ savedAt: Date.now(), values: captured.values }));
      captured.persisted = true;
      render(value => value + 1);
    } catch { /* Keep the existing unsaved-navigation guard active. */ }
  }, [owner, scope, persistentKey, captured]);
  const update = (patch: Partial<MatrixFormDraft>, manual: boolean) => {
    if (active.current.entry !== captured || active.current.owner !== owner || active.current.scope !== scope) return;
    if (patch.regionsUnrestricted === true) patch = { ...patch, regions: '' };
    else if (patch.regions !== undefined && patch.regionsUnrestricted === undefined) patch = { ...patch, regionsUnrestricted: undefined };
    captured.values = normalizeDraft({ ...captured.values, ...patch });
    captured.edited ||= manual;
    if (manual) for (const key of Object.keys(patch) as Array<keyof MatrixFormDraft>) captured.touched.add(key);
    captured.persisted = false;
    if (persistentKey) {
      try {
        sessionStorage.setItem(prefix + persistentKey, JSON.stringify({ savedAt: Date.now(), values: captured.values }));
        captured.persisted = true;
      } catch { /* The page's existing unsaved-navigation guard remains active. */ }
    }
    render(value => value + 1);
  };
  return {
    values: entry.values, hasEdits: entry.edited, persisted: entry.persisted, restored: entry.restored,
    setField<K extends keyof MatrixFormDraft>(key: K, value: MatrixFormDraft[K]) { update({ [key]: value }, true); },
    setRegions(regions: string, regionsUnrestricted: boolean) { update({ regions, regionsUnrestricted }, true); },
    hydrate(values: Partial<MatrixFormDraft>) {
      if (captured.restored) return;
      const untouched = Object.fromEntries(Object.entries(values).filter(([key]) => !captured.touched.has(key as keyof MatrixFormDraft))) as Partial<MatrixFormDraft>;
      if (Object.keys(untouched).length) update(untouched, false);
    },
    adoptScope(nextScope: string, nextPersistentKey?: string) {
      if (active.current.entry !== captured) return;
      const next: Entry = { ...captured, values: { ...captured.values }, touched: new Set(captured.touched) };
      entries!.set(nextScope, next);
      if (nextPersistentKey) {
        try { sessionStorage.setItem(prefix + nextPersistentKey, JSON.stringify({ savedAt: Date.now(), values: next.values })); next.persisted = true; }
        catch { next.persisted = false; }
      }
    },
  };
}
