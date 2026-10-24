import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import { MarketRow, RowHead, MediaDialog, MediaShell, MediaCartFooter, MediaTaskbar, MediaDetails, useMarketRules, exportRows } from "../source-matrix/MediaMarket";
import PublishingFlowSteps, { flowStagesForMode, titleModeForFlowMode, type FlowStageMode } from "../components/PublishingFlowSteps";
import "../publishing.market.css";
import MediaCatalogueFilters from "../components/MediaCatalogueFilters";
import { catalogueInventory, chooseCatalogueSnapshot } from "../mediaCatalogue";
import {ReferenceIcon} from "../source-matrix/ReferenceIcons";
import { MarketRemark as PublishingRemark } from "../source-matrix/MediaMarket";
import { usePublishingWorkspaceKey } from "../host";
import { projectWorkspaceUrl } from "../host";
import {
  publishingDraftRequestKey,
  publishingHandoffRecordId,
  usePublishingFlow,
  usePublishingSummary,
} from "../PublishingFlowContext";
import {
  mediaSelectionBlocker,
  mediaShortlistKey,
} from "../mediaShortlist";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { useMediaSelectionTask } from "../useMediaSelectionTask";
import { withPublishingBatch } from "../batchPublishing";
import { batchArticleVersions, prepareBatchMediaDrafts, readBatchDraftJournal, uniqueBatchIds, withBatchArticleVersions } from "../batchMediaSelection";
import {
  usePublishingChoice,
} from "../components/PublishingConversation";
import {
  DEFAULT_MEDIA_FILTERS,
  readMediaRouteState as readSharedMediaRouteState,
  writeMediaRouteState as writeSharedMediaRouteState,
} from "../queryState";
import {
  formatPublishingMoney,
  type CatalogFreshness,
  type MediaList,
  type MediaFilters,
  type MediaResource,
  type PublicationDraft,
  type PublisherMediaKind,
} from "../types";

// This catalogue's all-media tab is explicit; other publishing screens keep their existing news default.
function readMediaRouteState(search: string) {
  const state = readSharedMediaRouteState(search);
  const kind = new URLSearchParams(search).get("kind");
  if (!kind || kind === "all") state.filters.kind = undefined;
  state.filters.searchScope = "name";
  return state;
}
function writeMediaRouteFilters(path:string,filters:MediaFilters,version?:string) {const result=writeSharedMediaRouteState(path,filters,version);if(filters.kind)return result;const [pathname,query]=result.split('?');const params=new URLSearchParams(query);params.set('kind','all');return pathname+'?'+params.toString();}
export default function PublishingMediaLibraryPage({
  draftId: routeDraftId,
  view = "third",
}: {
  draftId?: string;
  view?: "home" | "third" | "owned" | "cart";
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const batchParams = new URLSearchParams(search);
  const isBatch = batchParams.get('mode') === 'batch' || batchParams.getAll('batchDraft').length > 1 || batchParams.getAll('batchArticleVersion').length > 1;
  const batchVersionIds = isBatch ? batchArticleVersions(
    batchParams.has('batchDraft') && !batchParams.has('batchArticleVersion') ? undefined : batchParams.get('articleVersion') ?? undefined, search,
    batchParams.has('batchDraft') ? [] : flow?.selections?.batchArticleVersionIds ?? flow?.resources?.filter(resource => resource.kind === 'article_version').map(resource => resource.id)) : [];
  const batchVersionKey = JSON.stringify(batchVersionIds);
  const routeBatchArticleIds = uniqueBatchIds(batchParams.getAll('batchArticle'));
  const batchArticleKey = JSON.stringify(routeBatchArticleIds);
  const excludedBatchDraftIds = uniqueBatchIds(batchParams.getAll('excludedDraft'));
  const batchExclusionKey = JSON.stringify(excludedBatchDraftIds);
  const savedBatchDraftIds = flow?.selections?.batchDraftIds;
  const batchDraftIds = isBatch ? uniqueBatchIds([
    ...(routeDraftId ? [routeDraftId] : []),
    ...(batchParams.get('draftId') ? [batchParams.get('draftId')!] : []),
    ...(batchParams.getAll('batchDraft').length ? batchParams.getAll('batchDraft') :
      Array.isArray(savedBatchDraftIds) ? savedBatchDraftIds.filter((id): id is string => typeof id === 'string') :
      flow?.resources?.filter(resource => resource.kind === 'publication_draft').map(resource => resource.id) ?? []),
  ]) : [];
  const batchDraftKey = JSON.stringify(batchDraftIds);
  const draftId =
    isBatch ? undefined : routeDraftId ??
    flow?.resources?.find((resource) => resource.kind === "publication_draft")
      ?.id;
  // Carry each identifier under its own name across home/list/cart and filters.
  // In particular, a frozen version must not disappear at the home -> list link.
  const matrixTask = new URLSearchParams(search).get('matrixTask') ?? '';
  const carryMediaContext = (path: string) => {
    const [pathname, query] = path.split('?');
    const params = new URLSearchParams(query);
    const current = new URLSearchParams(search);
    for (const key of ['mode', 'workbenchTask', 'matrixTask', 'operatorOwnerId', 'enterpriseProjectId']) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
    if (isBatch) {
      params.set('mode', 'batch');
      for (const [key, values] of [['batchArticleVersion', batchVersionIds], ['batchDraft', batchDraftIds], ['batchArticle', routeBatchArticleIds], ['excludedDraft', excludedBatchDraftIds]] as const) {
        params.delete(key);
        for (const value of values) params.append(key, value);
      }
    }
    return pathname + (params.size ? '?' + params.toString() : '');
  };
  const writeMediaRouteState = (path:string,next:MediaFilters,version?:string) => {
    return carryMediaContext(writeMediaRouteFilters(path,next,version));
  };
  const pageHref=(path:string)=>writeMediaRouteState(path,filters,articleVersionId);
  const sourceHref = (path: string) => {
    const [pathname, query] = carryMediaContext(path).split('?');
    const params = new URLSearchParams(query);
    if (draftId) params.set('draftId', draftId);
    else if (isBatch && batchDraftIds[0]) params.set('draftId', batchDraftIds[0]);
    if (articleVersionId) params.set('articleVersion', articleVersionId);
    params.delete('matrixTask');
    if (matrixTask) params.set('task', matrixTask);
    return projectWorkspaceUrl(pathname + (params.size ? '?' + params.toString() : ''));
  };
  const workspaceKey = usePublishingWorkspaceKey();
  const accountShortlistKey = mediaShortlistKey(workspaceKey, search);
  const taskContextVersion = new URLSearchParams(search).get('articleVersion');
  const taskContextRouteTask = new URLSearchParams(search).get('workbenchTask');
  const taskContextMode = new URLSearchParams(search).get('mode');
  const taskContext = useMemo(() => ({ gateway, workspaceKey, accountShortlistKey, routeDraftId, taskContextVersion, taskContextRouteTask, taskContextMode, batchVersionKey, matrixTask, flowScope: flow?.scopeKey, agent: flow?.agentId }),
    [gateway, workspaceKey, accountShortlistKey, routeDraftId, taskContextVersion, taskContextRouteTask, taskContextMode, batchVersionKey, matrixTask, flow?.scopeKey, flow?.agentId]);
  const selectionTask = useMediaSelectionTask(flow, taskContext);
  const shortlistKey =
    flow && accountShortlistKey
      ? `${accountShortlistKey}:task:${selectionTask.scopeKey}`
      : accountShortlistKey;
  const pathname = location || "/publishing/media";
  const routeState = useMemo(() => readMediaRouteState(search), [search]);
  const { filters } = routeState;
  const articleVersionId =
    isBatch ? batchVersionIds[0] : routeState.articleVersionId ??
    flow?.resources?.find((resource) => resource.kind === "article_version")
      ?.id;
  const [entry, chooseEntry] = usePublishingChoice(
    "mediaEntry",
    draftId || articleVersionId || flow?.selections?.mediaSelection
      ? "catalog"
      : "",
  );
  const [confirmedMediaJson, , acceptConfirmedMedia] = usePublishingChoice(
    "mediaConfirmedSelection",
  );
  const confirmedMedia = useMemo(() => {
    try {
      const rows = JSON.parse(confirmedMediaJson);
      return Array.isArray(rows)
        ? rows
            .filter(
              (
                item,
              ): item is {
                id: string;
                name: string;
                priceTenThousandths: string;
              } =>
                item &&
                typeof item.id === "string" &&
                typeof item.name === "string" &&
                typeof item.priceTenThousandths === "string" &&
                /^\d+$/u.test(item.priceTenThousandths),
            )
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  }, [confirmedMediaJson]);
  const flowTaskId = selectionTask.scopeKey;
  const routeTaskId = new URLSearchParams(search).get('workbenchTask');
  const routeMode = new URLSearchParams(search).get('mode');
  // Registering the newly saved draft changes flow.resources. It is an adoption
  // of this operation's result, not a user navigation. Check the actual route
  // separately before navigating after that asynchronous registration.
  const routeOwner = useMemo(
    () => ({ gateway, accountShortlistKey, pathname, search, flowTaskId }),
    [gateway, accountShortlistKey, pathname, search, flowTaskId],
  );
  const currentRouteOwner = useRef(routeOwner);
  currentRouteOwner.current = routeOwner;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const selectionScope = useMemo(
    () => ({ gateway, shortlistKey, draftId, articleVersionId, flowTaskId, routeTaskId, routeMode, matrixTask }),
    [gateway, shortlistKey, draftId, articleVersionId, flowTaskId, routeTaskId, routeMode, matrixTask],
  );
  const [selection, setSelection] = useState(() => ({
    scope: selectionScope,
    items: new Map<string, MediaResource>(),
  }));
  const selected = useMemo(
    () =>
      selection.scope === selectionScope
        ? selection.items
        : new Map<string, MediaResource>(),
    [selection, selectionScope],
  );
  const setSelected = useCallback(
    (items: Map<string, MediaResource>) =>
      setSelection({ scope: selectionScope, items }),
    [selectionScope],
  );
  const batchState = useMemo(() => ({
    drafts: new Map<string, PublicationDraft>(),
    originalMediaIds: [] as string[],
    initialized: false,
    edited: false,
    journal: readBatchDraftJournal(flow?.selections?.batchDraftCreationJournal),
  }), [selectionScope]);
  const [batchSnapshot, setBatchSnapshot] = useState<{ scope: typeof selectionScope; drafts: PublicationDraft[] }>();
  const batchDrafts = batchSnapshot?.scope === selectionScope ? batchSnapshot.drafts : [];
  const [draftState, setDraftState] = useState<{
    scope: typeof selectionScope;
    value?: PublicationDraft;
  }>();
  const draft =
    draftState?.scope === selectionScope ? draftState.value : undefined;
  const latestDraft = useRef<typeof draftState>(undefined);
  const setDraft = useCallback(
    (value?: PublicationDraft) => {
      const next = { scope: selectionScope, value };
      latestDraft.current = next;
      setDraftState(next);
    },
    [selectionScope],
  );
  const [selectionError, setSelectionError] = useState("");
  const [registrationIssue, setRegistrationIssue] = useState<{
    gateway: typeof gateway;
    accountShortlistKey: typeof accountShortlistKey;
    taskId: typeof flowTaskId;
    draftId: string;
    articleVersionId: string;
    message?: string;
    acknowledged?: boolean;
  }>();
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mediaStep, chooseMediaStep, acceptMediaStep] =
    usePublishingChoice("mediaStep");
  const articleChooserOpen = mediaStep === "article";
  const setArticleChooserOpen = (open: boolean) =>
    chooseMediaStep(open ? "article" : "catalog");
  const [chosenVersion, setChosenVersion] =
    usePublishingChoice("mediaChosenVersion");
  const [boundDraft, setBoundDraft] = useState<PublicationDraft>();
  const [confirmedDraft, setConfirmedDraft] = useState<PublicationDraft>();
  const outputDraftId = (boundDraft ?? confirmedDraft)?.id;
  const [handoffReceipt, setHandoffReceipt] = useState<{
    draftId: string;
    recordId: string;
  }>();
  useEffect(() => {
    let active = true;
    if (outputDraftId)
      void publishingHandoffRecordId(`media-publishing-${outputDraftId}`).then(
        (recordId) => {
          if (active) setHandoffReceipt({ draftId: outputDraftId, recordId });
        },
      );
    return () => {
      active = false;
    };
  }, [outputDraftId]);
  const publishingTarget =
    handoffReceipt?.draftId === outputDraftId
      ? flow?.records?.find(
          (record) =>
            record.id === handoffReceipt?.recordId &&
            record.status === "completed" &&
            record.targetTask?.agentId === "publishing",
        )?.targetTask
      : undefined;
  const selectionInFlight = useRef(false);
  const selectionGeneration = useRef(0);
  useLayoutEffect(() => {
    selectionGeneration.current += 1;
    selectionInFlight.current = false;
    setSelectionBusy(false);
    setSelectionError("");
    setBoundDraft(undefined);
    setConfirmedDraft(undefined);
    return () => {
      selectionGeneration.current += 1;
    };
  }, [selectionScope]);
  const observedCatalogRevision = useRef<string | undefined>(undefined);
  const [catalogRevisionChange, setCatalogRevisionChange] = useState<{
    previous: string;
    current: string;
  }>();

  const [marketNotice,setMarketNotice]=useState('');
  const [scope, setScope] = useState<'all'|'cart'>('all');
  const [compact,setCompact]=useState(false);
  const [detailMedia,setDetailMedia]=useState<MediaResource>();
  const favorite=(_id:string)=>setMarketNotice('收藏接口尚未配置，未保存本次收藏。');
  const [dialogMessage,setDialogMessage]=useState('');
  const [previewOpen,setPreviewOpen]=useState(false),[mobilePreview,setMobilePreview]=useState(false);
  const [selectionReason,setSelectionReason]=useState('');
  const [quoteMedia,setQuoteMedia]=useState<MediaResource>();
  const [quotePrice,setQuotePrice]=useState(''),[quoteSource,setQuoteSource]=useState(''),[quoteAck,setQuoteAck]=useState(false),[quoteError,setQuoteError]=useState('');
  const [templateOpen,setTemplateOpen]=useState(false),[templateName,setTemplateName]=useState(''),[templateError,setTemplateError]=useState('');
  const [dataInfoOpen,setDataInfoOpen]=useState(false);
  const selectedIdsKey = scope === "cart" ? JSON.stringify([...selected.keys()].sort()) : "";
  const scopedMediaIds = useMemo<string[] | undefined>(
    () => scope === "cart" ? JSON.parse(selectedIdsKey) as string[] : undefined,
    [scope, selectedIdsKey],
  );
  const loadMedia = useCallback(
    (signal: AbortSignal, pageOverride = filters.page): Promise<MediaList> =>
      gateway.listMedia({ ...filters, searchScope: "name", page: pageOverride, mediaIds: scopedMediaIds }, signal),
    [filters, gateway, scopedMediaIds],
  );
  // Facets are inventory-wide, not derived from the current page or category.
  const loadFacets = useCallback(
    (signal: AbortSignal) => gateway.getMediaFacets({ ...DEFAULT_MEDIA_FILTERS, kind: undefined, searchScope: "name" }, signal),
    [gateway],
  );
  const loadArticles = useCallback(
    (signal: AbortSignal) => gateway.listArticles(signal),
    [gateway],
  );
  const loadDraft = useCallback(
    (signal: AbortSignal) =>
      draftId ? gateway.getDraft(draftId, signal) : Promise.resolve(undefined),
    [draftId, gateway],
  );
  const mediaQuery = usePublisherQuery(
    loadMedia,
    `media:${workspaceKey}:${JSON.stringify(filters)}:${scope}:${selectedIdsKey}`,
  );
  const facetsQuery = usePublisherQuery(
    loadFacets,
    `media-catalogue-facets:${workspaceKey}`,
  );
  const [inventorySnapshot, setInventorySnapshot] = useState<{
    gateway: typeof gateway; workspaceKey: typeof workspaceKey; catalog: CatalogFreshness;
  }>();
  const previousCatalog = inventorySnapshot?.gateway === gateway && inventorySnapshot.workspaceKey === workspaceKey
    ? inventorySnapshot.catalog : undefined;
  const inventoryReading = mediaQuery.loading || mediaQuery.refreshing;
  const catalog = chooseCatalogueSnapshot(mediaQuery.data?.catalog, previousCatalog, inventoryReading)
    ?? facetsQuery.data?.catalog;
  useEffect(() => {
    if (inventoryReading || mediaQuery.error || !mediaQuery.data) return;
    const current = mediaQuery.data.catalog;
    setInventorySnapshot(previous => {
      const sameScope = previous?.gateway === gateway && previous.workspaceKey === workspaceKey;
      const chosen = chooseCatalogueSnapshot(current, sameScope ? previous?.catalog : undefined, false)!;
      if (sameScope && previous?.catalog === chosen) return previous;
      return { gateway, workspaceKey, catalog: chosen };
    });
  }, [gateway, workspaceKey, inventoryReading, mediaQuery.data, mediaQuery.error]);
  const articlesQuery = usePublisherQuery(loadArticles, "article-choices");
  const draftQuery = usePublisherQuery(loadDraft, `media-draft:${draftId ?? "none"}:${shortlistKey ?? workspaceKey}:${flowTaskId}:${routeTaskId}:${routeMode}:${matrixTask}`);
  const needsFrozenVersion = Boolean(!isBatch && articleVersionId && !draftId && !draft);
  const loadBatch = useCallback(async (signal: AbortSignal) => {
    if (!isBatch) return undefined;
    const drafts = await Promise.all(batchDraftIds.map(id => gateway.getDraft(id, signal)));
    if (drafts.some((draft, index) => draft.id !== batchDraftIds[index])) throw new Error('读取的批量草稿与当前任务不一致。');
    const versions = batchVersionIds.length ? batchVersionIds : drafts.map(draft => draft.articleVersionId);
    if (!versions.length) throw new Error('本次批量稿件没有冻结版本，请返回稿件页面确认。');
    const articleIdsByVersion: Record<string, string> = {};
    if (routeBatchArticleIds.length) {
      if (routeBatchArticleIds.length !== versions.length) throw new Error('批量稿件与版本数量不一致，请返回原任务重试。');
      const articles = await Promise.all(routeBatchArticleIds.map(id => gateway.getArticle(id, signal)));
      articles.forEach((article, index) => {
        if (article.id !== routeBatchArticleIds[index] || (article.currentVersionId !== versions[index] && !article.versions.some(version => version.id === versions[index])))
          throw new Error('冻结版本不属于指定稿件，请返回原任务重新确认。');
        articleIdsByVersion[versions[index]] = article.id;
      });
    }
    if (drafts.some(draft => !versions.includes(draft.articleVersionId) && !Object.values(articleIdsByVersion).includes(draft.articleId)))
      throw new Error('批量草稿与选定稿件不一致，请返回原任务重试。');
    const frozen = await Promise.all(versions.map(id => gateway.getArticleVersion(id, signal)));
    if (frozen.some((version, index) => version.id !== versions[index] || !version.frozen)) throw new Error('批量稿件中存在未确认的冻结版本。');
    return { drafts, versions, frozen, articleIdsByVersion, excludedArticleIds: drafts.filter(draft => excludedBatchDraftIds.includes(draft.id)).map(draft => draft.articleId) };
  }, [gateway, isBatch, batchDraftKey, batchVersionKey, batchArticleKey, batchExclusionKey]);
  const batchQuery = usePublisherQuery(loadBatch, `media-batch:${shortlistKey}:${flowTaskId}:${batchVersionKey}:${batchDraftKey}:${batchArticleKey}:${batchExclusionKey}`);
  const batchSelectionStorageKey = `publishing-batch-media:${accountShortlistKey ?? workspaceKey}:${batchVersionKey}:${batchDraftKey}`;
  const loadFrozenVersion = useCallback(
    (signal: AbortSignal) => needsFrozenVersion
      ? typeof gateway.getArticleVersion === 'function'
        ? gateway.getArticleVersion(articleVersionId!, signal)
        : Promise.reject(new Error('当前入口尚未接入冻结版本读取，请重新载入或联系管理员。'))
      : Promise.resolve(undefined),
    [gateway, needsFrozenVersion, articleVersionId],
  );
  const versionQuery = usePublisherQuery(
    loadFrozenVersion,
    `media-version:${articleVersionId ?? 'none'}:${needsFrozenVersion}`,
  );
  const frozenVersion = versionQuery.data?.id === articleVersionId && versionQuery.data?.frozen
    ? versionQuery.data : undefined;
  // Working-copy imageCount can change without changing the frozen version ID.
  // Unknown/missing version metadata is a recoverable read state, not text-only.
  const articleHasImages = isBatch ? batchQuery.data?.frozen.some(version => version.containsImages) ?? false : draft?.articleContainsImages ?? frozenVersion?.containsImages ?? false;
  const draftReadIssue = !draftId ? ''
    : draftQuery.error ? `投放草稿读取失败：${draftQuery.error.message}`
    : draftQuery.loading || draftQuery.refreshing ? '正在读取投放草稿…'
    : !draft ? (draftQuery.loading ? '正在读取投放草稿…' : '未能读取指定投放草稿，请重试。')
    : draft.id !== draftId ? '读取的投放草稿与当前任务不一致，请重试。'
    : articleVersionId && draft.articleVersionId !== articleVersionId ? '投放草稿与指定冻结版本不一致，请返回稿件页面核对。' : '';
  const versionReadIssue = !needsFrozenVersion ? ''
    : versionQuery.error ? `冻结稿件读取失败：${versionQuery.error.message}`
    : !frozenVersion ? (versionQuery.loading ? '正在读取冻结稿件…'
      : '指定冻结版本不存在或尚未确认，请返回稿件页面核对。') : '';
  const contextReadIssue = isBatch
    ? batchQuery.error?.message || (!batchQuery.data ? '正在读取全部批量稿件…' : '')
    : draftReadIssue || versionReadIssue;
  useEffect(() => {
    if (!isBatch || !batchQuery.data || selectionInFlight.current) return;
    for (const incoming of batchQuery.data.drafts) {
      const previous = batchState.drafts.get(incoming.articleVersionId);
      if (!previous || incoming.revision > previous.revision) batchState.drafts.set(incoming.articleVersionId, incoming);
    }
    setBatchSnapshot({ scope: selectionScope, drafts: [...batchState.drafts.values()] });
    if (batchState.initialized) return;
    batchState.initialized = true;
    const union = new Map(batchQuery.data.drafts.filter(draft => !batchQuery.data!.excludedArticleIds.includes(draft.articleId)).flatMap(draft => draft.items.map(item => [item.media.id, item.media] as const)));
    batchState.originalMediaIds = [...union.keys()];
    let savedVersions = flow?.selections?.batchMediaVersionIds;
    let savedSelection = flow?.selections?.batchMediaSelection;
    if (!flow) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(batchSelectionStorageKey) ?? 'null');
        savedVersions = stored?.versions;
        savedSelection = stored?.media;
      } catch { /* A corrupt display selection cannot replace server drafts. */ }
    }
    if (JSON.stringify(savedVersions) === JSON.stringify(batchQuery.data.versions) && Array.isArray(savedSelection)) {
      const rows = savedSelection.filter((row): row is MediaResource => Boolean(row && typeof row.id === 'string' && typeof row.priceTenThousandths === 'string'));
      setSelected(new Map(rows.map(row => [row.id, row])));
      batchState.edited = true;
    } else setSelected(union);
  }, [isBatch, batchQuery.data, batchState, selectionScope, setSelected]);
  useEffect(() => {
    const canonical =
      writeMediaRouteState(pathname, filters, articleVersionId);
    const current = search
      ? `${pathname}?${search.replace(/^\?/u, "")}`
      : pathname;
    if (canonical !== current) navigate(canonical, { replace: true });
  }, [
    articleVersionId,
    filters,
    navigate,
    pathname,
    search,
  ]);



  const hasFlow = Boolean(flow);
  useEffect(() => {
    const incoming = draftQuery.data;
    if (!draftId || !incoming || incoming.id !== draftId || selectionInFlight.current) return;
    const current = latestDraft.current;
    if (current?.scope === selectionScope && current.value?.id === incoming.id &&
        current.value.revision >= incoming.revision) return;
    setDraft(incoming);
    if (hasFlow) {
      setBoundDraft(incoming);
      setConfirmedDraft(incoming);
    }
    setSelected(
      new Map(incoming.items.map((item) => [item.media.id, item.media])),
    );
  }, [draftId, draftQuery.data, hasFlow, selectionScope, selectionBusy, setDraft, setSelected]);

  const persistedSelection = flow?.selections?.mediaSelection;
  useEffect(() => {
    if (isBatch || !flow || draftId || articleVersionId || !Array.isArray(persistedSelection)) return;
    const rows = persistedSelection.filter((row): row is MediaResource =>
      Boolean(
        row &&
          typeof row === "object" &&
          typeof row.id === "string" &&
          typeof row.priceTenThousandths === "string",
      ),
    );
    setSelected(new Map(rows.slice(0, 20).map((row) => [row.id, row])));
  }, [draftId, articleVersionId, persistedSelection, setSelected]);



  useEffect(() => {
    const revision = mediaQuery.data?.catalog.activeRevision;
    if (!revision) return;
    if (!observedCatalogRevision.current) {
      observedCatalogRevision.current = revision;
      return;
    }
    if (observedCatalogRevision.current === revision) return;
    setCatalogRevisionChange({
      previous: observedCatalogRevision.current,
      current: revision,
    });
    observedCatalogRevision.current = revision;
  }, [mediaQuery.data?.catalog.activeRevision]);

  const selectedValues = useMemo(() => [...selected.values()], [selected]);
  const selectedTotal = useMemo(
    () =>
      selectedValues
        .reduce((sum, media) => sum + (/^\d+$/.test(media.priceTenThousandths) && BigInt(media.priceTenThousandths) > 0n ? BigInt(media.priceTenThousandths) : 0n), 0n)
        .toString(),
    [selectedValues],
  );
  const selectedCounts = useMemo(
    () => ({
      news: selectedValues.filter((media) => media.kind === "news").length,
      self_media: selectedValues.filter((media) => media.kind === "self_media")
        .length,
    }),
    [selectedValues],
  );

  const navigateFilters = (
    next: MediaFilters,
    nextPath = pathname,
    nextVersion = articleVersionId,
    nextTaskId?: string,
  ) => {
    const target = writeMediaRouteState(nextPath, next, nextVersion);
    if (nextTaskId) {
      const url = new URL(target, window.location.origin);
      url.searchParams.set('workbenchTask', nextTaskId);
      navigate(url.pathname + url.search + url.hash);
    } else navigate(target);
    void flow?.saveSelections({ mediaFilters: { ...next, kind: next.kind ?? "all" } }).catch(() => undefined);
  };
  const updateFilter = <K extends keyof MediaFilters>(
    key: K,
    value: MediaFilters[K],
  ) => {
    navigateFilters({
      ...filters,
      [key]: value,
      page: key === "page" ? Number(value) : 1,
    });
  };

  const persistMediaIds = async (
    mediaIds: string[],
    optimistic: Map<string, MediaResource>,
  ) => {
    if (contextReadIssue) {
      setSelectionError(contextReadIssue);
      return;
    }
    if (isBatch) {
      if (selectionInFlight.current || !batchQuery.data) return;
      const generation = selectionGeneration.current;
      selectionInFlight.current = true;
      setSelectionBusy(true);
      try {
        if (flow) await flow.saveSelections({ batchMediaSelection: [...optimistic.values()], batchMediaVersionIds: batchQuery.data.versions,
          batchArticleVersionIds: batchQuery.data.versions, batchArticleIds: batchQuery.data.versions.map(id => batchQuery.data!.articleIdsByVersion[id] ?? batchQuery.data!.drafts.find(draft => draft.articleVersionId === id)?.articleId).filter((id): id is string => Boolean(id)),
          excludedDraftIds: excludedBatchDraftIds, mediaFilters: { ...filters, kind: filters.kind ?? 'all' } });
        else sessionStorage.setItem(batchSelectionStorageKey, JSON.stringify({ versions: batchQuery.data.versions, media: [...optimistic.values()] }));
        if (generation !== selectionGeneration.current) return;
        batchState.edited = true;
        setSelected(optimistic);
        setSelectionError('');
      } catch (reason) {
        if (generation === selectionGeneration.current) setSelectionError(reason instanceof Error ? reason.message : '批量媒体选择未能保存，请重试。');
      } finally {
        if (generation === selectionGeneration.current) { selectionInFlight.current = false; setSelectionBusy(false); }
      }
      return;
    }
    // 从稿件进入（携带 articleVersion 且尚无草稿）时必须立即写入服务端草稿，
    // 不能因会话 flow 存在而退化为浏览器本地选择；无稿件上下文才用 flow/本地清单。
    if (!articleVersionId && !draft) {
      if (flow) {
        if (selectionInFlight.current) return;
        selectionInFlight.current = true;
        const generation = selectionGeneration.current;
        setSelectionBusy(true);
        try {
          await flow.saveSelections({
            mediaSelection: [...optimistic.values()],
            mediaFilters: { ...filters, kind: filters.kind ?? "all" },
          });
          if (generation === selectionGeneration.current) {
            setSelected(optimistic);
            setSelectionError("");
          }
        } catch (reason) {
          if (generation === selectionGeneration.current)
            setSelectionError(
              reason instanceof Error
                ? reason.message
                : "媒体选择未能保存，请重试",
            );
        } finally {
          if (generation === selectionGeneration.current) {
            selectionInFlight.current = false;
            setSelectionBusy(false);
          }
        }
      } else {
        setSelected(optimistic);
        setSelectionError("");
      }
      return;
    }
    if (selectionInFlight.current) return;
    selectionInFlight.current = true;
    const generation = selectionGeneration.current;
    const previousSelection = new Map(selected);
    setSelectionBusy(true);
    setSelectionError("");
    setSelected(optimistic);
    try {
      if (draft) {
        const saved = await gateway.updateDraftMedia(
          draft.id,
          mediaIds,
          draft.revision,
        );
        if (generation !== selectionGeneration.current) return;
        setDraft(saved);
        setSelected(
          new Map(saved.items.map((item) => [item.media.id, item.media])),
        );
      } else {
        const taskId = await selectionTask.ensureTask();
        const requestKey = taskId
          ? await publishingDraftRequestKey(taskId, articleVersionId!, mediaIds)
          : undefined;
        if (generation !== selectionGeneration.current) return;
        const intendedTitleMode = titleModeForFlowMode(flowMode);
        const saved = await gateway.createDraft(
          articleVersionId!,
          mediaIds,
          requestKey,
          intendedTitleMode,
        );
        if (generation !== selectionGeneration.current) return;
        setDraft(saved);
        setSelected(
          new Map(saved.items.map((item) => [item.media.id, item.media])),
        );
        // Keep the current subpage after the first click. The bare media route
        // belongs to the overview, not to an implicit third-party-list default.
        const savedPath = `/publishing/drafts/${encodeURIComponent(saved.id)}/media${view === 'home' ? '' : '/' + view}`;
        let registrationError = '';
        try {
          await flow?.record({
            id: `media-draft:${saved.id}`,
            label: '已保存媒体选择',
            resources: [
              { kind: 'article_version', id: saved.articleVersionId },
              { kind: 'publication_draft', id: saved.id },
            ],
          });
        } catch (reason) {
          // The server draft already exists. Retain that exact ID; never roll
          // back into an unbound page that would create a replacement draft.
          registrationError = '媒体已保存，但任务关联未完成：' + (reason instanceof Error ? reason.message : '请重试');
        }
        if (!mounted.current || currentRouteOwner.current !== routeOwner) return;
        if (registrationError) setRegistrationIssue({
          gateway, accountShortlistKey, taskId: flowTaskId,
          draftId: saved.id, articleVersionId: saved.articleVersionId, message: registrationError,
        });
        navigateFilters(filters, savedPath, articleVersionId, taskId);
      }
    } catch (reason) {
      if (generation !== selectionGeneration.current) return;
      if (draft)
        setSelected(
          new Map(draft.items.map((item) => [item.media.id, item.media])),
        );
      else setSelected(previousSelection);
      setSelectionError(
        reason instanceof Error && reason.message.includes('Media title is invalid')
          ? '所选媒体的提交标题不符合要求，媒体选择未保存。请核对媒体标题字数限制，并返回稿件编辑调整标题后重新确认；已有投放草稿可返回标题配置调整。'
          : reason instanceof Error ? reason.message : "所选媒体未能保存",
      );
    } finally {
      if (generation === selectionGeneration.current) {
        selectionInFlight.current = false;
        setSelectionBusy(false);
      }
    }
  };

  const toggle = (media: MediaResource) => {
    if (selectionInFlight.current || selectionBusy) return;
    if (contextReadIssue) { setSelectionError(contextReadIssue); return; }
    setBoundDraft(undefined);
    const next = new Map(selected);
    if (next.has(media.id)) {
      next.delete(media.id);
      void persistMediaIds([...next.keys()], next);
      return;
    }
    if (!ruleData.ready || mediaQuery.loading || mediaQuery.error) {
      setSelectionError(ruleData.error || mediaQuery.error?.message || '正在读取媒体资料，请稍后再选。');
      return;
    }
    const blocker = mediaSelectionBlocker(media, articleHasImages);
    if (blocker) {
      setSelectionError(blocker);
      return;
    }
    if (next.size >= 20) {
      setSelectionError("一次最多选择 20 家媒体");
      return;
    }
    next.set(media.id, media);
    void persistMediaIds([...next.keys()], next);
  };

  const clearSelection = () => {
    if (!selected.size || selectionBusy) return;
    setBoundDraft(undefined);
    void persistMediaIds([], new Map());
  };

  const refreshChangedCatalog = () => {
    setCatalogRevisionChange(undefined);
    if (filters.page === 1) {
      mediaQuery.reload();
      return;
    }
    navigateFilters({ ...filters, page: 1 });
  };

  const pageCount = mediaQuery.data
    ? Math.max(1, Math.ceil(mediaQuery.data.total / mediaQuery.data.pageSize))
    : 1;
  useEffect(() => {
    if (!mediaQuery.data || filters.page <= pageCount) return;
    navigateFilters({ ...filters, page: pageCount });
  }, [filters, mediaQuery.data, pageCount]);
  const frozenArticles =
    articlesQuery.data?.filter((article) => article.currentVersionId) ?? [];
  const selectedArticle = articlesQuery.data?.find((article) =>
    draft
      ? article.id === draft.articleId
      : article.currentVersionId === articleVersionId,
  );
  usePublishingSummary({
    title: "当前投放选择",
    items: flow
      ? []
      : [
          {
            label: "已选媒体",
            value: `${selected.size} 家 · 软文 ${selectedCounts.news} / 自媒体 ${selectedCounts.self_media}`,
          },
          { label: "预估合计", value: formatPublishingMoney(selectedTotal) },
          {
            label: "当前稿件",
            value:
              (boundDraft ?? draft)?.articleTitle ??
              selectedArticle?.title ??
              "待选择冻结稿件",
          },
          {
            label: "状态",
            value: selectionBusy
              ? "正在保存"
              : boundDraft
                ? "稿件已绑定，等待交接"
                : "选择中",
          },
          ...selectedValues.map((media) => ({
            label: media.name,
            value: formatPublishingMoney(media.priceTenThousandths),
          })),
        ],
    note: selectionError || "最终报价与发布能力在预检时重新核对。",
    outputs:
      (boundDraft ?? confirmedDraft)
        ? [
            {
              id: `media-draft:${(boundDraft ?? confirmedDraft)!.id}`,
              title: `${(boundDraft ?? confirmedDraft)!.items.length} 家媒体与稿件已确认`,
              description: (boundDraft ?? confirmedDraft)!.articleTitle,
              type: "投放选择",
              version: (boundDraft ?? confirmedDraft)!.articleVersion,
              pendingChanges: !boundDraft,
              status: publishingTarget
                ? "已交接到发布任务"
                : "等待交给发布助手",
              onOpen: () => {
                if (publishingTarget) {
                  void handoff();
                  return;
                }
                chooseEntry("selected");
                setDrawerOpen(true);
              },
              onRevise: () => {
                chooseEntry("catalog");
                setBoundDraft(undefined);
              },
            },
          ]
        : confirmedMedia.length
          ? [
              {
                id: "confirmed-media-selection",
                title: `已确认 ${confirmedMedia.length} 家媒体`,
                description: confirmedMedia.map((item) => item.name).join("、"),
                type: "媒体清单",
                status: `选择时预估 ${formatPublishingMoney(confirmedMedia.reduce((sum, item) => sum + BigInt(item.priceTenThousandths), 0n).toString())} · 待选择稿件`,
                pendingChanges:
                  confirmedMedia
                    .map((item) => item.id)
                    .sort()
                    .join(",") !== [...selected.keys()].sort().join(","),
                onOpen: () => {
                  chooseEntry("selected");
                  setDrawerOpen(true);
                },
                onRevise: () => {
                  chooseEntry("catalog");
                  setDrawerOpen(true);
                },
              },
            ]
          : [],
  });

  const chooseArticle = (alreadySaved = false) => {
    setDrawerOpen(false);
    const currentVersion = draft?.articleVersionId ?? articleVersionId;
    setChosenVersion(
      frozenArticles.some(
        (article) => article.currentVersionId === currentVersion,
      )
        ? currentVersion!
        : "",
    );
    if (alreadySaved) acceptMediaStep("article");
    else setArticleChooserOpen(true);
  };
  const bindArticle = async () => {
    if (!chosenVersion || selectionInFlight.current) return;
    if (!selected.size) {
      setArticleChooserOpen(false);
      navigateFilters(
        { ...filters, page: 1 },
        "/publishing/media",
        chosenVersion,
      );
      return;
    }
    selectionInFlight.current = true;
    const generation = selectionGeneration.current;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      // A new draft also clears titles from the previously selected article.
      const mediaIds = [...selected.keys()];
      const taskId = flow ? await flow.ensureTask() : undefined;
      const requestKey = taskId
        ? await publishingDraftRequestKey(taskId, chosenVersion, mediaIds)
        : undefined;
      if (generation !== selectionGeneration.current) return;
      const saved = await gateway.createDraft(
        chosenVersion,
        mediaIds,
        requestKey,
        titleModeForFlowMode(flowMode),
      );
      if (generation !== selectionGeneration.current) return;
      setDraft(saved);
      setArticleChooserOpen(false);
      if (flow) {
        setBoundDraft(saved);
        setConfirmedDraft(saved);
        await flow.record({
          id: `media-bound:${saved.id}`,
          label: `已选择 ${saved.items.length} 家媒体并绑定稿件`,
          detail: `${saved.articleTitle} · v${saved.articleVersion}`,
          resources: [
            { kind: "article_version", id: saved.articleVersionId },
            { kind: "publication_draft", id: saved.id },
          ],
          outputRefs: [
            {
              resource: {
                kind: "publication_draft",
                id: saved.id,
                label: saved.articleTitle,
              },
              version: String(saved.revision),
              sourceStepId: `media-bound:${saved.id}`,
            },
          ],
        });
      } else navigate(projectWorkspaceUrl(saved.titleMode==="single"?`/publishing/drafts/${saved.id}/review`:`/publishing/drafts/${saved.id}/titles`));
    } catch (error) {
      if (generation !== selectionGeneration.current) return;
      setSelectionError(
        error instanceof Error ? error.message : "稿件绑定失败，请重试",
      );
    } finally {
      if (generation === selectionGeneration.current) {
        selectionInFlight.current = false;
        setSelectionBusy(false);
      }
    }
  };
  const continueSelection = async () => {
    if (isBatch) { await continueBatchSelection(); return; }
    if (selectionInFlight.current || !selected.size) return;
    if (contextReadIssue) { setSelectionError(contextReadIssue); return; }
    const generation = selectionGeneration.current;
    selectionInFlight.current = true;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      if (flow) {
        const confirmed = JSON.stringify(
          selectedValues.map(({ id, name, priceTenThousandths }) => ({
            id,
            name,
            priceTenThousandths,
          })),
        );
        await (flow.saveValues ?? flow.saveSelections)({
          mediaConfirmedSelection: confirmed,
          mediaStep: draft ? "catalog" : "article",
        });
        if (generation !== selectionGeneration.current) return;
        acceptConfirmedMedia(confirmed);
      }
      if (flow && draft) {
        setBoundDraft(draft);
        setConfirmedDraft(draft);
      } else if (draft) navigate(projectWorkspaceUrl(draft.titleMode==="single"?`/publishing/drafts/${draft.id}/review`:`/publishing/drafts/${draft.id}/titles`));
      else chooseArticle(Boolean(flow));
    } catch (cause) {
      if (generation === selectionGeneration.current)
        setSelectionError("媒体清单尚未确认保存，请重试；当前选择已保留。");
    } finally {
      if (generation === selectionGeneration.current) {
        selectionInFlight.current = false;
        setSelectionBusy(false);
      }
    }
  };
  const continueBatchSelection = async () => {
    if (selectionInFlight.current || !selected.size || !batchQuery.data || contextReadIssue) return;
    selectionInFlight.current = true;
    const generation = selectionGeneration.current;
    const isCurrent = () => mounted.current && generation === selectionGeneration.current;
    setSelectionBusy(true);
    setSelectionError('');
    try {
      const versionIds = batchQuery.data.versions;
      const taskId = await selectionTask.ensureTask();
      if (!isCurrent()) return;
      const identity = taskId ?? `${accountShortlistKey ?? workspaceKey}:${versionIds.join(':')}`;
      const storageKey = `publishing-batch-create:${accountShortlistKey ?? workspaceKey}:${identity}:${JSON.stringify(versionIds)}`;
      // Local recovery stores only IDs and the immutable creation request; task
      // values carry the same receipt across workbench resumes and devices.
      if (!batchState.journal.length) {
        try { batchState.journal = readBatchDraftJournal(JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')); } catch { /* Task persistence remains authoritative. */ }
      }
      const saved = await prepareBatchMediaDrafts({
        gateway, versionIds, articleIdsByVersion: batchQuery.data.articleIdsByVersion, excludedArticleIds: batchQuery.data.excludedArticleIds, existingDrafts: [...batchState.drafts.values()], selectedMediaIds: [...selected.keys()],
        originalMediaIds: batchState.originalMediaIds, journal: batchState.journal,
        requestKey: (versionId, mediaIds) => publishingDraftRequestKey(`batch:${identity}`, versionId, mediaIds),
        persistJournal: async journal => {
          let stored = false;
          try { sessionStorage.setItem(storageKey, JSON.stringify(journal)); stored = true; } catch { /* Use durable task values when available. */ }
          if (flow) {
            await flow.saveSelections({ batchDraftCreationJournal: journal.map(entry => ({ ...entry, initialMediaIds: [...entry.initialMediaIds] })),
              batchArticleVersionIds: versionIds, batchArticleIds: versionIds.map(id => batchQuery.data!.articleIdsByVersion[id] ?? batchQuery.data!.drafts.find(draft => draft.articleVersionId === id)?.articleId).filter((id): id is string => Boolean(id)), excludedDraftIds: excludedBatchDraftIds });
          } else if (!stored) throw new Error('浏览器无法保留批量重试记录，请允许存储后重试。');
        },
        onSaved: async item => {
          for (const [version, previous] of batchState.drafts) {
            if (previous.articleId === item.articleId && version !== item.articleVersionId) batchState.drafts.delete(version);
          }
          batchState.drafts.set(item.articleVersionId, item);
          if (isCurrent()) setBatchSnapshot({ scope: selectionScope, drafts: [...batchState.drafts.values()] });
          // Every successful draft remains recoverable if a later article fails.
          await flow?.record({ id: `media-draft:${item.id}`, label: '已保存批量稿件的媒体选择', resources: [
            ...versionIds.map(id => ({ kind: 'article_version' as const, id })),
            ...(batchDraftIds.length ? batchDraftIds : [...batchState.drafts.values()].map(draft => draft.id)).map(id => ({ kind: 'publication_draft' as const, id })),
          ] });
        }, isCurrent,
      });
      if (!isCurrent() || !saved.length) return;
      const draftIds = saved.map(item => item.id);
      const excludedDraftIds = saved.filter(item => batchQuery.data!.excludedArticleIds.includes(item.articleId)).map(item => item.id);
      const resources = saved.flatMap(item => [
        { kind: 'article' as const, id: item.articleId }, { kind: 'article_version' as const, id: item.articleVersionId }, { kind: 'publication_draft' as const, id: item.id },
      ]);
      await flow?.saveSelections({ batchDraftIds: draftIds, batchArticleVersionIds: versionIds,
        excludedDraftIds, batchArticleIds: saved.map(item => item.articleId), batchMediaSelection: null, batchMediaVersionIds: [], batchDraftCreationJournal: [] });
      if (!isCurrent()) return;
      batchState.journal = [];
      try { sessionStorage.removeItem(storageKey); } catch { /* The saved task now owns the complete group. */ }
      try { sessionStorage.removeItem(batchSelectionStorageKey); } catch { /* Server drafts now own each media mapping. */ }
      const route = withPublishingBatch(withBatchArticleVersions(carryMediaContext(`/publishing/drafts/${encodeURIComponent(saved[0].id)}/titles`), versionIds), draftIds, excludedDraftIds);
      if (flow) {
        await flow.record({ id: `media-batch:${draftIds.join(':')}`, label: `已确认 ${saved.length} 篇稿件的媒体`, resources: batchDraftIds.length ? [
          ...resources.filter(resource => resource.kind !== 'publication_draft'),
          ...batchDraftIds.map(id => ({ kind: 'publication_draft' as const, id })),
        ] : resources });
        if (!isCurrent()) return;
        await flow.handoff({ targetAgentId: 'publishing', title: `批量发布 · ${saved.length} 篇稿件`, resources,
          idempotencyKey: `media-publishing-batch-${draftIds.join(':')}`, route });
      } else navigate(projectWorkspaceUrl(route));
    } catch (reason) {
      if (isCurrent()) setSelectionError((reason instanceof Error ? reason.message : '批量媒体保存未完成') + '；已保存的稿件会保留，重试会继续本批次。');
    } finally {
      if (isCurrent()) { selectionInFlight.current = false; setSelectionBusy(false); }
    }
  };
  const handoff = async () => {
    if (!flow || !boundDraft || selectionInFlight.current) return;
    if (publishingTarget) {
      const url = new URL(
        projectWorkspaceUrl(
          boundDraft.titleMode === "single"
            ? `/publishing/drafts/${boundDraft.id}/review`
            : `/publishing/drafts/${boundDraft.id}/titles`,
        ),
        window.location.origin,
      );
      url.searchParams.set("workbenchTask", publishingTarget.conversationId);
      navigate(`${url.pathname}${url.search}`);
      return;
    }
    selectionInFlight.current = true;
    const generation = selectionGeneration.current;
    setSelectionBusy(true);
    setSelectionError("");
    try {
      await flow.handoff({
        targetAgentId: "publishing",
        title: `发布 · ${boundDraft.articleTitle}`,
        resources: [
          { kind: "article_version", id: boundDraft.articleVersionId },
          { kind: "publication_draft", id: boundDraft.id },
        ],
        idempotencyKey: `media-publishing-${boundDraft.id}`,
        route: boundDraft.titleMode==="single"?`/publishing/drafts/${boundDraft.id}/review`:`/publishing/drafts/${boundDraft.id}/titles`,
      });
    } catch (reason) {
      if (generation !== selectionGeneration.current) return;
      setSelectionError(
        reason instanceof Error ? reason.message : "交接未完成，请重试",
      );
    } finally {
      if (generation === selectionGeneration.current) {
        selectionInFlight.current = false;
        setSelectionBusy(false);
      }
    }
  };
  const sourceRows=view==='cart'?selectedValues:mediaQuery.data?.items??[];
  const ruleData=useMarketRules([...new Set([...sourceRows.map(x=>x.id),...(detailMedia?[detailMedia.id]:[])])],mediaQuery.data?.catalog.activeRevision??'');
  const rows=ruleData.ready?sourceRows:[];
  const additionReadIssue = !ruleData.ready ? ruleData.error || '正在读取媒体要求…'
    : mediaQuery.error?.message || (mediaQuery.loading ? '正在读取媒体目录…' : '');
  const selectionDisabledReason = (media: MediaResource) => {
    if (selectionBusy) return '正在保存媒体选择…';
    if (contextReadIssue) return contextReadIssue;
    if (selected.has(media.id)) return undefined;
    return additionReadIssue || mediaSelectionBlocker(media, articleHasImages) ||
      (selected.size >= 20 ? '一次最多选择 20 家媒体，请先取消其他媒体。' : undefined);
  };
  // Disabled resources do not prevent an otherwise fully selected page from
  // being unchecked. Already selected resources must remain removable.
  const actionableRows = rows.filter(media => selected.has(media.id) || (selected.size < 20 && !additionReadIssue && !mediaSelectionBlocker(media, articleHasImages)));
  const allActionableSelected = actionableRows.length > 0 && actionableRows.every(media => selected.has(media.id));
  const bulkDisabled = selectionBusy || Boolean(contextReadIssue) || !actionableRows.length ||
    (selected.size >= 20 && !actionableRows.some(media => selected.has(media.id)));
  const togglePage = (checked: boolean) => {
    if (bulkDisabled || selectionInFlight.current) return;
    const next = new Map(selected);
    for (const media of actionableRows) {
      if (!checked) next.delete(media.id);
      else if (!additionReadIssue && next.size < 20 && !mediaSelectionBlocker(media, articleHasImages)) next.set(media.id, media);
    }
    if (next.size === selected.size && [...next.keys()].every(id => selected.has(id))) return;
    setBoundDraft(undefined);
    void persistMediaIds([...next.keys()], next);
  };
  const base=draftId?`/publishing/drafts/${encodeURIComponent(draftId)}/media`:'/publishing/media';
  const task=boundDraft??draft;
  const currentArticleTitle = isBatch ? `批量稿件 · ${batchQuery.data?.versions.length ?? batchVersionIds.length} 篇` : task?.articleTitle ?? selectedArticle?.title ?? (articleVersionId ? '已确认稿件' : undefined);
  const currentArticleVersion = task?.articleVersion ?? frozenVersion?.version;
  const batchArticleIds = isBatch ? uniqueBatchIds([
    ...routeBatchArticleIds,
    ...batchDrafts.map(item => item.articleId),
    ...(flow?.resources?.filter(resource => resource.kind === 'article').map(resource => resource.id) ?? []),
    ...(batchQuery.data?.versions.flatMap(id => articlesQuery.data?.filter(article => article.currentVersionId === id).map(article => article.id) ?? []) ?? []),
  ]) : [];
  const currentArticleId = isBatch ? batchArticleIds[0] : task?.articleId ?? selectedArticle?.id;
  const articleEditHref = (() => {
    if (!currentArticleId) return '/publishing/articles';
    const params = new URLSearchParams();
    if (isBatch) {
      params.set('mode', 'batch');
      batchArticleIds.forEach(id => params.append('batchArticle', id));
      batchDraftIds.forEach(id => params.append('batchDraft', id));
      excludedBatchDraftIds.forEach(id => params.append('excludedDraft', id));
      batchQuery.data?.versions.forEach(id => params.append('batchArticleVersion', id));
    }
    const workbenchTask = new URLSearchParams(search).get('workbenchTask');
    if (workbenchTask) params.set('workbenchTask', workbenchTask);
    return `/publishing/articles/${encodeURIComponent(currentArticleId)}/edit${params.size ? '?' + params.toString() : ''}`;
  })();
  const currentArticleNote = isBatch ? '本次媒体选择将保留全部稿件，逐篇配置发布标题。' : currentArticleVersion !== undefined
    ? `稿件：已确认 v${currentArticleVersion}`
    : articleVersionId ? `冻结版本：${articleVersionId}` : undefined;
  const registrationMatches = Boolean(registrationIssue && registrationIssue.gateway === gateway &&
    registrationIssue.accountShortlistKey === accountShortlistKey && registrationIssue.taskId === flowTaskId &&
    registrationIssue.draftId === draft?.id && registrationIssue.articleVersionId === draft?.articleVersionId);
  const draftRegistered = Boolean(draft && flow && flow.records?.some(record => record.id === `media-draft:${draft.id}` && record.status === 'completed') &&
    flow.resources?.some(resource => resource.kind === 'publication_draft' && resource.id === draft.id) &&
    flow.resources?.some(resource => resource.kind === 'article_version' && resource.id === draft.articleVersionId));
  // Reconstruct this recoverable state from the verified draft and current
  // task after route remounts. Never retain a prior workspace's draft object.
  const registrationPending = Boolean(flow && draft && draft.id === draftId && !contextReadIssue && !draftRegistered &&
    !(registrationMatches && registrationIssue?.acknowledged));
  const registrationMessage = registrationMatches && registrationIssue?.message
    ? registrationIssue.message : '当前媒体选择已保存，但尚未关联到当前任务。请重试关联后再返回稿件入口。';
  const retryRegistration = async () => {
    if (!flow || !registrationPending || !draft || contextReadIssue || selectionBusy) return;
    const saved = draft;
    const owner = routeOwner;
    try {
      await flow.record({ id: `media-draft:${saved.id}`, label: '已保存媒体选择', resources: [
        { kind: 'article_version', id: saved.articleVersionId },
        { kind: 'publication_draft', id: saved.id },
      ] });
      if (mounted.current && currentRouteOwner.current === owner) setRegistrationIssue({
        gateway, accountShortlistKey, taskId: flowTaskId,
        draftId: saved.id, articleVersionId: saved.articleVersionId, acknowledged: true,
      });
    } catch (reason) {
      if (mounted.current && currentRouteOwner.current === owner)
        setRegistrationIssue({
          gateway, accountShortlistKey, taskId: flowTaskId,
          draftId: saved.id, articleVersionId: saved.articleVersionId,
          message: '媒体已保存，但任务关联未完成：' + (reason instanceof Error ? reason.message : '请重试'),
        });
    }
  };
  // 统一流程条：以草稿 titleMode 为准；建稿前沿用编辑器带来的模式参数；独立浏览默认 4 步初始展示。
  const flowModeParam=new URLSearchParams(search.replace(/^\?/u, "")).get("mode");
  const flowMode:FlowStageMode=isBatch?"batch":task?.titleMode==="single"?"single":task?.titleMode==="per_media"?"per_media":flowModeParam==="single"?"single":flowModeParam==="per_media"?"per_media":flowModeParam==="multi"?"multi":flowModeParam==="batch"?"batch":"default";
  const hasArticleContext=Boolean(isBatch||task||articleVersionId||draftId);
  const flowSteps=<PublishingFlowSteps stages={flowStagesForMode(flowMode)} doneCount={hasArticleContext?1:0} activeIndex={hasArticleContext?1:0}/>;
  const next=()=>{if(!hasArticleContext||contextReadIssue||selectionBusy||!selected.size)return;if(boundDraft&&flow)void handoff();else void continueSelection();};
  const exportRequest=useRef<AbortController|null>(null),[exporting,setExporting]=useState(false);
  useEffect(()=>{exportRequest.current?.abort();setExporting(false);return()=>exportRequest.current?.abort();},[workspaceKey,JSON.stringify(filters),scope,selectedIdsKey]);
  const exportCatalogue=async()=>{if(exporting)return;const abort=new AbortController();exportRequest.current?.abort();exportRequest.current=abort;setExporting(true);try{const first=await loadMedia(abort.signal,1),all=[...first.items];for(let page=2;(page-1)*first.pageSize<first.total;page++){const next=await loadMedia(abort.signal,page);if(next.catalog.activeRevision!==first.catalog.activeRevision)throw new Error('导出期间目录已更新，请重试。');all.push(...next.items);}if(!abort.signal.aborted)exportRows(all);}catch(e){if(!abort.signal.aborted)setDialogMessage(e instanceof Error?e.message:'媒体清单导出失败');}finally{if(!abort.signal.aborted)setExporting(false);}};
  const reset = () => { navigateFilters({ ...DEFAULT_MEDIA_FILTERS, kind: undefined, searchScope: "name" }); setScope("all"); };
  const inventory = catalogueInventory(catalog);
  const inventoryLabel = (value: number | undefined) => value === undefined ? (mediaQuery.loading && facetsQuery.loading ? "…" : "待确认") : value.toLocaleString("zh-CN");
  const resultTotal = mediaQuery.data?.total;
  const totalLabel = resultTotal === undefined ? (mediaQuery.loading ? "…" : "待确认") : resultTotal.toLocaleString("zh-CN");
  const pending=selectedValues.filter(m=>!/^\d+$/.test(m.priceTenThousandths)||BigInt(m.priceTenThousandths)<=0n).length;
  const nextLabel=flowMode==="single"?"预检发布":"配置标题";
  const footer=<MediaCartFooter count={selected.size} total={selectedTotal} pending={pending} cartHref={pageHref(base+'/cart')} onNext={next} nextLabel={nextLabel} nextDisabled={!hasArticleContext||!!contextReadIssue||selectionBusy||!selected.size} nextHint={!hasArticleContext?"您还未选择稿件":contextReadIssue||(selectionBusy?'正在保存媒体选择…':!selected.size?'请先选择媒体':undefined)} articlesHref={hasArticleContext?undefined:projectWorkspaceUrl('/publishing/articles')} items={selectedValues} onRemove={media=>toggle(media)}/>;
  useEffect(()=>{if(articleChooserOpen&&!chosenVersion&&frozenArticles[0]?.currentVersionId)setChosenVersion(frozenArticles[0].currentVersionId);},[articleChooserOpen,chosenVersion,frozenArticles,setChosenVersion]);
  return <MediaShell steps={flowSteps} title={view==='home'?'媒体库':view==='cart'?'第三方购物车':'第三方媒体选择'} notice={view==='home'?<div className="notice x-home-notice">矩阵先按问题与媒体适配生成；填写预算后，再推荐组合。两种选媒方式共用一个购物车。</div>:undefined} note={view==='home'?'分析信源、比较媒体，统一管理本次投放清单。':view==='cart'?'逐篇分配投放稿件；报价缺失单独标记，不参与已确认金额合计。':'一行一个媒体，横向对比平台、稿件要求和发布备注；勾选即加入购物车。'} actions={view==='third'||view==='owned'?<button className="button secondary" onClick={()=>void exportCatalogue()}><ReferenceIcon name="download"/>导出媒体清单</button>:view==='home'&&currentArticleTitle?<span className="x-task-pill" title={currentArticleTitle}>稿件：{currentArticleTitle}{currentArticleVersion !== undefined ? ` · v${currentArticleVersion}` : ''}</span>:undefined} taskbar={<MediaTaskbar note={currentArticleNote} saveStatus={selectionBusy?'正在保存…':contextReadIssue || (task?'已读取投放草稿':frozenVersion?'已读取冻结稿件':'')} title={currentArticleTitle?(view==='home'?'当前稿件：':'')+currentArticleTitle:undefined} count={selected.size} total={selectedTotal} cart={view!=='home'} cartHref={pageHref(base+'/cart')} actions={currentArticleId&&<>{task&&<button className="link small" onClick={()=>setPreviewOpen(true)}>查看稿件</button>}<Link className="link small" href={projectWorkspaceUrl(articleEditHref)}>返回编辑</Link></>}><select aria-label="当前投放任务" value={hasArticleContext?'current':'research'} onChange={e=>{if(e.target.value==='research')navigate(projectWorkspaceUrl('/publishing/media/third'));}}><option value="research">独立浏览 / 研究</option>{hasArticleContext&&<option value="current">{currentArticleTitle??'正在读取稿件'}</option>}</select></MediaTaskbar>}>
  {contextReadIssue&&<div className="notice warn" style={{marginBottom:14}} role="status">
    {contextReadIssue}
    {isBatch ? <button className="link" disabled={batchQuery.loading||batchQuery.refreshing} onClick={()=>batchQuery.reload()}>重试读取批量稿件</button>
      : draftId ? <button className="link" disabled={draftQuery.loading||draftQuery.refreshing} onClick={()=>draftQuery.reload()}>重试读取草稿</button>
      : <button className="link" disabled={versionQuery.loading} onClick={()=>versionQuery.reload()}>重试读取稿件</button>}
    <Link className="link" href={projectWorkspaceUrl('/publishing/articles')}>返回稿件</Link>
  </div>}
  {isBatch && <div className="notice" style={{marginBottom:14}}>
    共 {batchQuery.data?.versions.length ?? batchVersionIds.length} 篇稿件。新增媒体应用于全部稿件；已有稿件各自的媒体分配会保留，移除媒体则从本批次所有稿件中移除。
    {batchDrafts.length > 0 && <ul>{batchDrafts.map(item => <li key={item.id}>{item.articleTitle} · v{item.articleVersion} · {item.items.length} 家媒体</li>)}</ul>}
  </div>}
  {registrationPending && <div className="notice warn" role="alert">{registrationMessage}<button className="link" disabled={selectionBusy} onClick={()=>void retryRegistration()}>重试关联任务</button></div>}
  {view==='home'?<>
  <div className="x-duo-grid">
    <section className="panel x-duo-card">
      <div className="x-duo-head"><div className="metric-icon"><ReferenceIcon name="layer"/></div><div><h2>信源矩阵</h2><p>先看哪些信源适合本次问题，再按预算选择搭配。</p></div></div>
      <div className="x-duo-steps">
        <div className="x-step-chip"><b>1</b><div><strong>生成信源矩阵</strong><span>适配与证据优先</span></div><small>无需填写预算</small></div>
        <div className="x-step-chip"><b>2</b><div><strong>按预算推荐组合</strong><span>比较覆盖与费用</span></div><small>确认后再加入购物车</small></div>
      </div>
      <div className="x-duo-tags"><span className="x-muted-tag">分析</span><span className="x-duo-arrow">→</span><span className="x-muted-tag">矩阵</span><span className="x-duo-arrow">→</span><span className="x-muted-tag">预算组合</span></div>
      <Link className="button primary x-duo-cta" href={sourceHref('/publishing/source-matrix')}>进入信源矩阵 →</Link>
    </section>
    <section className="panel x-duo-card">
      <div className="x-duo-head"><div className="metric-icon"><ReferenceIcon name="send"/></div><div><h2>媒体选择</h2><p>搜索和筛选第三方媒体，对比发布条件与两项 AI 指标。</p></div></div>
      <div className="x-metric-chips">
        <div className="x-metric-chip"><strong>AI引用率<span className="r-help" tabIndex={0}>ⓘ<span>AI 在引用标注中列出该信源的次数 ÷ 总测试提问次数。</span></span></strong><span>引用标注中列出信源</span></div>
        <div className="x-metric-chip"><strong>AI提及率<span className="r-help" tabIndex={0}>ⓘ<span>AI 输出正文包含信源的样本数 ÷ 总测试提问次数。</span></span></strong><span>输出正文包含信源</span></div>
      </div>
      <p className="small muted x-metric-note">指标口径来自信源分析定义；当前媒体目录暂未接入实测数值。</p>
      <div className="x-duo-tags"><span className="x-muted-tag">媒体属性与 AI 指标并列展示</span></div>
      <Link className="button primary x-duo-cta" href={pageHref(base+'/third')}>进入媒体选择 →</Link>
    </section>
  </div>
  <section className="panel x-cart-summary">
    <div className="grow"><h2>共用购物车</h2><p className="small muted">矩阵组合与手选媒体统一汇总，生成本身不入车。</p></div>
    <div className="x-cart-metrics">{draftReadIssue?<strong>{draftQuery.loading||draftQuery.refreshing?'正在读取购物车…':'购物车暂不可用，请重试读取草稿'}</strong>:<><strong>{selected.size} 家 · {pending?'已知报价合计 ':''}{formatPublishingMoney(selectedTotal)}</strong><span className="small muted">{selected.size?`已确认选择 · ${pending} 项费用待确认`:'尚未选择媒体'}</span></>}</div>
    <Link className="button secondary" href={projectWorkspaceUrl(pageHref(base+'/cart'))}>查看购物车 →</Link>
  </section>
  <p className="footer-note">媒体、报价与发布要求来自已配置的供应商接口；不保证收录或 AI 引用。</p>
</>:view==='cart'?<>
   <div className="actions" style={{marginBottom:18}}><Link className="button secondary" href={projectWorkspaceUrl(pageHref(base+'/third'))}>← 继续选择媒体</Link><button className="button quiet" onClick={()=>exportRows(selectedValues)}>导出清单</button><button className="button quiet" onClick={()=>{setTemplateError('');setTemplateOpen(true);}}>保存组合模板</button><button className="link danger" onClick={()=>setDialogMessage('clear')}>清空购物车</button></div>
   {!task&&!isBatch&&<div className="notice" style={{marginBottom:16}}>当前是独立研究清单。配置标题前，请绑定已确认稿件；清单与报价会一并保留。</div>}
   {catalogRevisionChange&&<div className="notice warn" style={{marginBottom:16}}>媒体目录已更新。<button className="link" onClick={refreshChangedCatalog}>重新读取媒体目录</button></div>}
   <div className="panel y-cart-panel">{selected.size?<div className="table-wrap"><table className="y-cart-table"><thead><tr><th>媒体 / 发布备注</th><th>单篇报价</th><th>投放稿件</th><th>规则与操作</th></tr></thead><tbody>{selectedValues.map(m=><tr key={m.id}><td className="y-cart-resource"><strong>{m.name}</strong><p className="y-subtle-note" style={{margin:'4px 0'}}>{m.platform} · {m.id}</p><div className="y-remarks-line"><span>发布备注</span><PublishingRemark text={ruleData.rules[m.id]?.rawRemark??m.remark} media={m} rules={ruleData.rules[m.id]}/></div></td><td><strong className="b-price">{formatPublishingMoney(m.priceTenThousandths)}</strong><p className="y-subtle-note">目录报价 · 发布前复核</p><button className="link" onClick={()=>{setQuoteError('');setQuoteMedia(m);}}>查看 / 修改报价</button></td><td>{isBatch?<span className="small muted">本批次 {batchQuery.data?.versions.filter(versionId=>{const item=batchState.drafts.get(versionId);return !item||item.items.some(row=>row.media.id===m.id)||!batchState.originalMediaIds.includes(m.id);}).length ?? batchVersionIds.length} 篇稿件 · 下一步逐篇配置</span>:task?<label><input type="checkbox" checked onChange={()=>setDialogMessage('当前投放草稿按稿件保存媒体；请通过任务选择更换稿件。')}/><span>文章 1 · {task.articleTitle} · v{task.articleVersion}</span></label>:<span className="small muted">尚未绑定稿件</span>}</td><td><div className="actions"><button className="link" onClick={()=>setDetailMedia(m)}>资料详情</button><button className="link" onClick={()=>setDetailMedia(m)}>投稿要求</button></div><button className="link danger" style={{marginTop:8}} onClick={()=>toggle(m)}>移除</button></td></tr>)}</tbody></table></div>:<div className="empty"><div className="metric-icon"><ReferenceIcon name="file"/></div><h2>购物车还没有媒体</h2><p>勾选媒体即可加入，原始备注与规则会一并带入。</p><div className="actions"><Link className="button primary" href={projectWorkspaceUrl(pageHref(base+'/third'))}>浏览媒体</Link></div></div>}</div>
   <label className="label" style={{marginTop:20}}>渠道选择理由</label><textarea placeholder="说明本次选择这些媒体的依据" value={selectionReason} onChange={e=>setSelectionReason(e.target.value)} onBlur={()=>{if(selectionReason)setDialogMessage('渠道选择理由保存接口尚未配置，本次输入尚未保存。');}}/><p className="y-subtle-note">已知小计 {formatPublishingMoney(selectedTotal)}；另有 {pending} 项报价 / 状态待确认。配置标题后可以先检查正文，未确认报价和未完成人工复核的项目无法提交。</p>{footer}
  </>:<div className={'y-catalogue '+(compact?'y-compact':'')}>
   <div className="y-data-strip"><span><strong>{mediaQuery.loading?'正在读取媒体目录':`当前匹配 ${totalLabel} 条媒体资源`}</strong>　备注悬停可展开；未提供的报价与要求保留为待确认。</span><button className="link" onClick={()=>setDataInfoOpen(true)}>数据说明 <ReferenceIcon name="info"/></button></div>
   <MediaCatalogueFilters filters={filters} facets={facetsQuery.data} facetsLoading={facetsQuery.loading} facetsError={facetsQuery.error?.message} onRetry={() => facetsQuery.reload()} onChange={navigateFilters} onReset={reset} />
   <div id="y-results" className="y-resultbar">
     <div className="y-result-tabs">
       <button className={scope === "all" ? "active" : ""} aria-pressed={scope === "all"} onClick={() => { setScope("all"); updateFilter("page", 1); }}>全部<small>{inventoryLabel(inventory?.all)}</small></button>
       <button disabled title="收藏功能暂未接入，无法读取或保存收藏">我的收藏<small>未接入</small></button>
       <button className={scope === "cart" ? "active" : ""} aria-pressed={scope === "cart"} onClick={() => { setScope("cart"); updateFilter("page", 1); }}>购物车<small>{selected.size}</small></button>
     </div>
     <span className="y-result-count" id="y-result-count" aria-live="polite">为您找到 <strong>{totalLabel}</strong> 条媒体资源{scope === "cart" ? "（购物车内）" : ""}</span>
   </div>
   <div className="y-typebar" role="group" aria-label="媒体分类">
     {([{ value: undefined, label: "全部媒体", count: inventory?.all }, { value: "news", label: "门户媒体", count: inventory?.news }, { value: "self_media", label: "第三方自媒体", count: inventory?.selfMedia }] as const).map(item => <button key={item.value ?? "all"} className={filters.kind === item.value ? "active" : ""} aria-pressed={filters.kind === item.value} onClick={() => navigateFilters({ ...filters, kind: item.value, page: 1 })}>{item.label}<small>（{inventoryLabel(item.count)}）</small></button>)}
   </div>
   {(!inventory || catalog?.stale || mediaQuery.error || inventoryReading) && <p className="mc-inventory-note" role="status">{!inventory ? "媒体库存统计尚未确认，分类数量暂不展示。" : mediaQuery.error ? "当前保留上次成功读取的目录与统计。" : inventoryReading ? "正在更新结果；库存保留最近一次确认的数量。" : "当前显示最近一次完整同步的库存数量，目录待更新。"}<button className="link" onClick={() => { mediaQuery.reload(); facetsQuery.reload(); }}>重新读取</button></p>}
   <div className="y-selection"><label><input type="checkbox" id="x-page-select" aria-label="本页全选" checked={allActionableSelected} disabled={bulkDisabled} onChange={event=>togglePage(event.target.checked)}/>本页全选<span style={{color:'#d3c6cf',margin:'0 4px'}}>|</span><strong id="b-selection-count">已选 {selected.size} 家</strong></label><div className="actions"><button className="link" onClick={()=>favorite('')}>批量收藏</button><button className="link" onClick={()=>exportRows(selectedValues)}>导出已选</button><button className="link" onClick={()=>setDialogMessage('clear')}>清空已选</button><button className="link" onClick={()=>setCompact(!compact)}>{compact?'展开信息':'精简信息'}</button></div></div>

   {mediaQuery.error&&rows.length>0&&<div className="notice warn" role="alert">媒体目录读取失败：{mediaQuery.error.message}。当前显示上次读取内容，请重试后继续添加。<button className="link" onClick={()=>{mediaQuery.reload();ruleData.reload();}}>重试读取媒体资料</button></div>}
   <div className="y-horizontal-scroll"><RowHead/><div id="b-third-table" className="y-media-list">{rows.map(media=><MarketRow catalogueFields key={media.id} media={media} rules={ruleData.rules[media.id]} checked={selected.has(media.id)} onToggle={()=>toggle(media)} disabled={!!selectionDisabledReason(media)} selectionDisabledReason={selectionDisabledReason(media)} onFavorite={()=>favorite(media.id)} onQuote={()=>{setQuoteError('');setQuoteMedia(media);}} onDetails={()=>setDetailMedia(media)}/>)}{!rows.length&&<div className="x-empty"><strong>{mediaQuery.loading||ruleData.loading?'正在读取媒体目录':mediaQuery.error||ruleData.error?'媒体资料暂不可用':'没有匹配的媒体'}</strong><p>{mediaQuery.error?.message||ruleData.error||'调整平台、关键词或其他条件后再试。已选媒体保持不变。'}</p><button className="button secondary x-small-button" disabled={mediaQuery.loading||ruleData.loading} onClick={()=>{if(mediaQuery.error||ruleData.error){mediaQuery.reload();ruleData.reload();}else reset();}}>{mediaQuery.error||ruleData.error?'重试读取媒体资料':'显示全部媒体'}</button></div>}</div></div>
   <div id="b-third-pages" className="y-pages"><span>共 {totalLabel} 家 · 第 {filters.page} / {pageCount} 页　<select aria-label="每页媒体数" value={filters.pageSize} onChange={e=>updateFilter('pageSize',Number(e.target.value))}>{[10,20,50].map(n=><option key={n} value={n}>{n} 家 / 页</option>)}</select></span><div className="y-page-buttons"><button aria-label="上一页" disabled={mediaQuery.loading || filters.page<=1} onClick={()=>updateFilter('page',filters.page-1)}>‹</button>{Array.from({length:pageCount},(_,i)=>i+1).filter(n=>pageCount<=8||n===1||n===pageCount||Math.abs(n-filters.page)<2).map(n=><button className={n===filters.page?'active':''} aria-label={'第 '+n+' 页'} aria-current={n===filters.page?'page':undefined} key={n} onClick={()=>updateFilter('page',n)}>{n}</button>)}<button aria-label="下一页" disabled={mediaQuery.loading || filters.page>=pageCount} onClick={()=>updateFilter('page',filters.page+1)}>›</button></div></div>
   <p className="y-list-footnote">媒体资源来自供应商目录。同名不同平台分别保留；报价与发布要求以发布前核验结果为准。</p>{footer}
  </div>}
  <MediaDialog open={dataInfoOpen} title="导入数据说明" description="媒体资料来自供应商目录；未提供的字段保留为未知。" confirmLabel="知道了" footer={<><button className="button secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({catalog:mediaQuery.data,rules:ruleData.rules},null,2)],{type:'application/json;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='FrontMind-原始抓取与备注.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}>导出原始记录</button><button className="button primary" onClick={()=>setDataInfoOpen(false)}>知道了</button></>} onCancel={()=>setDataInfoOpen(false)} onConfirm={()=>setDataInfoOpen(false)}><div className="y-info-metrics"><div><strong>{totalLabel}</strong><span>匹配媒体记录</span></div><div><strong>{sourceRows.length}</strong><span>当前页记录</span></div><div><strong>{sourceRows.filter(m=>!!ruleData.rules[m.id]?.rawRemark).length}</strong><span>当前页有备注</span></div><div><strong>{selected.size}</strong><span>已选媒体</span></div></div><p>{ruleData.error||'原始备注和解析规则按媒体 ID 关联；未知要求需人工核验。'}</p></MediaDialog>

  <MediaDialog description="" open={!!(dialogMessage||selectionError||marketNotice)} title={dialogMessage==='clear'?(view==='cart'?'清空第三方购物车':'清空已选媒体'):'操作提示'} confirmLabel={dialogMessage==='clear'?'确认清空':'关闭'} onCancel={()=>{setDialogMessage('');setSelectionError('');setMarketNotice('');}} onConfirm={()=>{if(dialogMessage==='clear')clearSelection();setDialogMessage('');setSelectionError('');setMarketNotice('');}}><p className={dialogMessage==='clear'?'reading':undefined}>{dialogMessage==='clear'?(view==='cart'?'移除当前任务所有第三方媒体。稿件、自有账号清单和已保存模板保留。':'将移除当前清单的全部媒体；稿件、已填写标题和已保存方案不受影响。'):dialogMessage||selectionError||marketNotice}</p></MediaDialog>
  <MediaDialog open={previewOpen} title="稿件预览" confirmLabel="返回" footer={<button className="button primary" onClick={()=>setPreviewOpen(false)}>返回</button>} onCancel={()=>setPreviewOpen(false)} onConfirm={()=>setPreviewOpen(false)}><div className="actions" style={{justifyContent:'center',marginBottom:16}}><button className="button secondary" onClick={()=>setMobilePreview(false)}>桌面</button><button className="button secondary" onClick={()=>setMobilePreview(true)}>手机</button></div><article id="preview-paper" className={'article-preview'+(mobilePreview?' mobile':'')}><h1>{task?.articleTitle||'未命名稿件'}</h1><div className="reading"><p className="block-error" role="alert">已确认 v{task?.articleVersion}。当前接口未返回此版本的完整正文，请返回编辑查看稿件。</p></div></article></MediaDialog>
  <MediaDialog open={templateOpen} title="保存组合模板" confirmLabel="保存模板" onCancel={()=>setTemplateOpen(false)} onConfirm={()=>setTemplateError('组合模板接口尚未配置，未保存本次组合。')}><label className="label" htmlFor="b-template-name">模板名称</label><input id="b-template-name" className="field" placeholder="例如：科技选型组合" value={templateName} onChange={e=>setTemplateName(e.target.value)}/>{templateError&&<p className="block-error" role="alert">{templateError}</p>}</MediaDialog>
  <MediaDialog open={!!quoteMedia} title={'录入已确认报价 · '+(quoteMedia?.name??'')} confirmLabel="保存已确认报价" onCancel={()=>setQuoteMedia(undefined)} onConfirm={()=>setQuoteError('报价写入接口尚未配置，未保存本次报价。')}><div className="notice">请填写已向供应商确认的单篇报价；保存前需要供应商报价写入接口。</div><label className="label" style={{marginTop:20}} htmlFor="y-quote-price">单篇价格（元） *</label><input className="field" type="number" id="y-quote-price" min="0" step="0.01" placeholder="请输入已确认价格" value={quotePrice} onChange={e=>setQuotePrice(e.target.value)}/><label className="label" style={{marginTop:14}} htmlFor="y-quote-source">报价来源 / 供应商 *</label><input className="field" id="y-quote-source" placeholder="例如：供应商名称与确认记录" value={quoteSource} onChange={e=>setQuoteSource(e.target.value)}/><label className="ack"><input type="checkbox" id="y-quote-ack" checked={quoteAck} onChange={e=>setQuoteAck(e.target.checked)}/><span>我已核对报价与可投状态。人工录入不代表系统核验或锁定供应商价格。</span></label><p id="y-quote-error" className="block-error" role="alert">{quoteError}</p></MediaDialog>
  <MediaDetails catalogueFields checked={!!detailMedia&&selected.has(detailMedia.id)} onToggle={()=>{if(detailMedia)toggle(detailMedia);}} onQuote={()=>setQuoteMedia(detailMedia)} media={detailMedia} rules={detailMedia?ruleData.rules[detailMedia.id]:undefined} onClose={()=>setDetailMedia(undefined)}/>
  <MediaDialog open={articleChooserOpen} title="绑定已确认稿件" confirmLabel="绑定并继续" busy={selectionBusy} onCancel={()=>setArticleChooserOpen(false)} onConfirm={()=>void bindArticle()} footer={<><Link className="button secondary" href={projectWorkspaceUrl('/publishing/articles')} onClick={()=>setArticleChooserOpen(false)}>查看稿件</Link><button className="button primary" disabled={selectionBusy} onClick={()=>void bindArticle()}>绑定并继续</button></>}><p className="small muted">选择已有的已确认任务，或返回编辑页确认稿件。研究清单将按资源去重复制到该任务，不覆盖任务原有选择。</p><select id="b-bind" value={chosenVersion} onChange={e=>setChosenVersion(e.target.value)}>{frozenArticles.map(article=><option key={article.currentVersionId} value={article.currentVersionId}>{article.title}</option>)}</select>{(articlesQuery.loading||articlesQuery.error||selectionError||!frozenArticles.length)&&<p className="block-error" role="alert">{selectionError||articlesQuery.error?.message||(articlesQuery.loading?'正在加载稿件…':'请先在稿件页面确认一份稿件')}</p>}</MediaDialog>
    </MediaShell>;
}
