import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { projectWorkspaceUrl } from "./host";
import { withPublishingBatch } from "./batchPublishing";
import { publishingTitleStage } from "./titleFlow";
import type { PublisherTitleMode } from "./types";
import type { WorkbenchTaskState, WorkbenchOutputRef, BusinessWorkspaceOutput } from "./flow-contracts";
import {
  DEFAULT_MEDIA_FILTERS,
  readMediaRouteState,
  writeMediaRouteState,
} from "./queryState";

export type PublishingResource = {
  kind:
    | "article"
    | "article_version"
    | "publication_draft"
    | "publication_batch";
  id: string;
};
export type PublishingFlowSummary = {
  title: string;
  items: Array<{ label: string; value: string }>;
  note?: string;
  outputs?: BusinessWorkspaceOutput[];
};
export type PublishingFlow = {
  taskId?: string;
  scopeKey?: string;
  pending?: boolean;
  outcomePending?: boolean;
  ensureTask: () => Promise<string>;
  agentId: string;
  selections?: Record<string, unknown>;
  resources?: PublishingResource[];
  records?: WorkbenchTaskState["records"];
  setSummary: (summary: PublishingFlowSummary | null) => void;
  record: (input: {
    id: string;
    label: string;
    detail?: string;
    resources?: PublishingResource[];
    outputRefs?: WorkbenchOutputRef[];
  }) => Promise<void>;
  saveSelections: (selections: Record<string, unknown>) => Promise<void>;
  /** Presentation choices do not advance a business operation. */
  saveValues?: (values: Record<string, unknown>) => Promise<void>;
  handoff: (input: {
    targetAgentId: "publishing" | "media" | "articles";
    title: string;
    resources: PublishingResource[];
    idempotencyKey: string;
    route: string;
  }) => Promise<void>;
};
export const PublishingFlowContext = createContext<PublishingFlow | null>(null);
export function PublishingFlowProvider({
  value,
  children,
}: {
  value: PublishingFlow;
  children: ReactNode;
}) {
  return (
    <PublishingFlowContext.Provider value={value}>
      {children}
    </PublishingFlowContext.Provider>
  );
}
export const usePublishingFlow = () => useContext(PublishingFlowContext);

/** Recover a business resource from its task, never from the previous task's URL. */
export function publishingTaskResumePath(
  agentId: string,
  state?: Pick<WorkbenchTaskState, "resources" | "step" | "values"> | null,
) {
  const resource = (kind: string) =>
    state?.resources.find((item) => item.kind === kind)?.id;
  const resources = (kind: string) => [...new Set(
    state?.resources.filter((item) => item.kind === kind).map((item) => item.id) ?? [],
  )];
  const savedIds = (key: string) => {
    const value = state?.values[key];
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))]
      : [];
  };
  const draftIds = savedIds("batchDraftIds").length
    ? savedIds("batchDraftIds") : resources("publication_draft");
  const versionIds = savedIds("batchArticleVersionIds").length
    ? savedIds("batchArticleVersionIds") : resources("article_version");
  const articleIds = savedIds("batchArticleIds").length
    ? savedIds("batchArticleIds") : resources("article");
  const batchMode = state?.values.editorMode === "batch" || savedIds("batchArticleVersionIds").length > 0 || versionIds.length > 1 || draftIds.length > 1;
  const savedModes = state?.values.publishingDraftTitleModes;
  const titleStage = publishingTitleStage(draftIds.map(id => {
    const value = savedModes && typeof savedModes === "object" && !Array.isArray(savedModes)
      ? (savedModes as Record<string, unknown>)[id] : undefined;
    return { titleMode: value === "single" || value === "per_media" ? value as PublisherTitleMode : undefined };
  }));
  if (agentId === "media") {
    const params = new URLSearchParams();
    const saved = state?.values.mediaFilters;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      // DEFAULT_MEDIA_FILTERS includes normalized coverage/platform dimensions
      // and legacy exact constraints. Restore both without inferring aliases.
      // mediaIds belongs to the current account's request scope, never to saved task filters.
      for (const key of [...Object.keys(DEFAULT_MEDIA_FILTERS), "searchScope"]) {
        const value = (saved as Record<string, unknown>)[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
          params.set(key, String(value));
      }
    }
    const route = writeMediaRouteState(
      "/publishing/media",
      readMediaRouteState(params.toString()).filters,
      versionIds[0],
    );
    const url = new URL(route, "https://publishing.invalid");
    if (batchMode) {
      versionIds.forEach((id) => url.searchParams.append("batchArticleVersion", id));
      url.searchParams.set("mode", "batch");
    } else if (state?.values.editorMode === "single" || state?.values.editorMode === "multi") {
      url.searchParams.set("mode", state.values.editorMode);
      if (!draftIds.length && (state.values.titleMode === "single" || state.values.titleMode === "per_media")) url.searchParams.set("titleMode", state.values.titleMode);
    }
    if (!batchMode && draftIds[0]) url.pathname = `/publishing/drafts/${encodeURIComponent(draftIds[0])}/media`;
    if (articleIds.length === versionIds.length)
      articleIds.forEach((id) => url.searchParams.append("batchArticle", id));
    if (batchMode && draftIds.length) url.pathname = `/publishing/drafts/${encodeURIComponent(draftIds[0]!)}/media`;
    return withPublishingBatch(`${url.pathname}${url.search}`, draftIds, savedIds("excludedDraftIds"));
  }
  if (agentId === "articles") {
    if (!articleIds.length) return "/publishing/articles";
    const params = new URLSearchParams();
    if (articleIds.length > 1 || state?.values.editorMode === "batch") {
      params.set("mode", "batch");
      articleIds.forEach((id) => params.append("batchArticle", id));
    } else if (state?.values.editorMode === "single" || state?.values.editorMode === "multi") {
      params.set("mode", state.values.editorMode);
    }
    if (draftIds.length === 1) params.set("draftId", draftIds[0]!);
    return withPublishingBatch(`/publishing/articles/${encodeURIComponent(articleIds[0]!)}/edit${params.size ? `?${params}` : ""}`, draftIds, savedIds("excludedDraftIds"));
  }
  const batch = resource("publication_batch");
  if (draftIds.length > 1 || (draftIds.length > 0 && state?.values.publishingBatchReviewPending)) {
    // A batch can be partially accepted: returning only its first receipt loses
    // pending drafts. The grouped review owns all per-draft receipts.
    const stage = batch || titleStage === "review" || state?.step === "titles" || state?.values.publishingBatchReviewPending
      ? "review" : "titles";
    return withPublishingBatch(
      `/publishing/drafts/${encodeURIComponent(draftIds[0]!)}/${stage}`,
      draftIds,
      savedIds("excludedDraftIds"),
    );
  }
  if (batch) return `/publishing/publications/${encodeURIComponent(batch)}`;
  const draft = draftIds[0];
  if (draft)
    return `/publishing/drafts/${encodeURIComponent(draft)}/${titleStage === "review" || state?.step === "titles" ? "review" : "titles"}`;
  return "/publishing";
}


export function publishingTaskUrl(path: string, taskId?: string) {
  const url = new URL(projectWorkspaceUrl(path), window.location.origin);
  if (taskId) url.searchParams.set("workbenchTask", taskId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** An old request may finish after its page is gone. It must not update or
 * navigate whichever task the user opened while waiting. */
export function usePublishingOperationScope(resourceKey = "") {
  const flow = usePublishingFlow();
  const key = `${projectWorkspaceUrl("/")}:${flow?.taskId ?? "standalone"}:${resourceKey}`;
  const current = useRef(key);
  current.current = key;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    const requested = current.current;
    return () => mounted.current && current.current === requested;
  }, []);
}

/** Summary changes follow business responses; they never initiate a paid action. */
export function usePublishingSummary(summary: PublishingFlowSummary) {
  const flow = usePublishingFlow();
  const latest = useRef(summary);
  latest.current = summary;
  const key = JSON.stringify(summary);
  const setSummary = flow?.setSummary;
  useEffect(() => {
    const value = latest.current;
    setSummary?.({
      ...value,
      outputs: value.outputs?.map((output) => ({
        ...output,
        onOpen: output.onOpen
          ? () =>
              latest.current.outputs
                ?.find((item) => item.id === output.id)
                ?.onOpen?.()
          : undefined,
        onRevise: output.onRevise
          ? () =>
              latest.current.outputs
                ?.find((item) => item.id === output.id)
                ?.onRevise?.()
          : undefined,
      })),
    });
    return () => setSummary?.(null);
  }, [key, setSummary]);
}

/** Stable for one task and frozen selection, including refresh and lost replies. */
export async function publishingDraftRequestKey(
  taskId: string,
  versionId: string,
  mediaIds: string[],
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([taskId, versionId, [...mediaIds].sort()]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `publisher:draft:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Match the server-owned handoff receipt without inferring ownership from titles. */
export async function publishingHandoffRecordId(idempotencyKey: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(idempotencyKey),
  );
  return `handoff-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
