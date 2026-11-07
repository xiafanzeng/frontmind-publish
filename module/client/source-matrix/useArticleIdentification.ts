import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { IdentificationFieldKey } from '../../shared/article-identification';
import { articleIdentificationStoreFor, emptyIdentificationSnapshot, type IdentificationHydrationOptions, type IdentificationIndustryCatalog, type IdentificationRoute, type IdentificationSnapshot, type IdentificationValues } from './article-identification-store';

export interface UseArticleIdentificationOptions extends IdentificationRoute {
  gateway: object;
  enabled: boolean;
  /** The owning page pauses auto identification until saved task hydration finishes. */
  autoIdentify: boolean;
}
export interface ArticleIdentification extends IdentificationSnapshot {
  setField: (key: IdentificationFieldKey, value: string) => void;
  hydrate: (values: Partial<IdentificationValues>, hydrationId: string, options?: IdentificationHydrationOptions) => void;
  setIndustryCatalog: (catalog: IdentificationIndustryCatalog) => void;
  remapIndustry: (fromId: string, toId: string) => void;
  identify: () => Promise<void>;
  retry: () => Promise<void>;
  adopt: (key: IdentificationFieldKey) => void;
  /** Transfer the current new-task form immediately before navigating to its saved ID. */
  adoptFormScope: (nextScope: string) => void;
}
const noopSubscribe = () => () => {};
const getEmpty = () => emptyIdentificationSnapshot;
export function useArticleIdentification({ gateway, workspace, articleVersionId, draftId, formScope, connectionEpoch, enabled, autoIdentify }: UseArticleIdentificationOptions): ArticleIdentification {
  const route = useMemo(() => enabled && articleVersionId ? articleIdentificationStoreFor(gateway).route({ workspace, articleVersionId, draftId, formScope, connectionEpoch }) : null,
    [gateway, workspace, articleVersionId, draftId, formScope, connectionEpoch, enabled]);
  const state = useSyncExternalStore(route?.subscribe ?? noopSubscribe, route?.getSnapshot ?? getEmpty, getEmpty);
  useEffect(() => route?.mount(), [route]);
  useEffect(() => { route?.setAutomatic(autoIdentify); return () => route?.setAutomatic(false); }, [route, autoIdentify]);
  const actions = useMemo(() => ({
    setField: (key: IdentificationFieldKey, value: string) => route?.setField(key, value),
    hydrate: (values: Partial<IdentificationValues>, hydrationId: string, options?: IdentificationHydrationOptions) => route?.hydrate(values, hydrationId, options),
    setIndustryCatalog: (catalog: IdentificationIndustryCatalog) => route?.setIndustryCatalog(catalog),
    remapIndustry: (fromId: string, toId: string) => route?.remapIndustry(fromId, toId),
    identify: async () => { await route?.identify(); }, retry: async () => { await route?.retry(); },
    adopt: (key: IdentificationFieldKey) => route?.adopt(key),
    adoptFormScope: (nextScope: string) => route?.adoptFormScope(nextScope),
  }), [route]);
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
