import {
  Check,
  ChevronDown,
  ExternalLink,
  Filter,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import { MarketRow, RowHead, MediaTabs, MediaTaskbar, MediaDetails, useMarketRules, exportRows, rulesRequest } from "../source-matrix/MediaMarket";
import "../publishing.market.css";
import type { MediaRules } from "../../server/providers/kol/media-rules";
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
  readMediaShortlist,
  saveMediaShortlist,
  switchMediaKind,
} from "../mediaShortlist";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import {
  PublishingQuestion,
  usePublishingChoice,
} from "../components/PublishingConversation";
import {
  MediaMark,
  PublishingEmpty,
  PublishingError,
  PublishingLoading,
  PublishingPage,
  PublishingPagination,
  PublishingSteps,
  PublishingConfirmDialog,
} from "../components/PublishingUi";
import {
  DEFAULT_MEDIA_FILTERS,
  parseBatchQuery,
  readMediaRouteState,
  writeMediaRouteState,
} from "../queryState";
import {
  formatPublishingMoney,
  type MediaList,
  type MediaFilters,
  type MediaResource,
  type PublicationDraft,
  type PublisherMediaKind,
} from "../types";

function kindLabel(kind: MediaResource["kind"]) {
  return kind === "self_media"
    ? "自媒体"
    : kind === "news"
      ? "软文媒体"
      : "历史媒体";
}

function capabilityLabel(capability: MediaResource["capability"]) {
  if (capability === "image") return "支持图文";
  if (capability === "image_pending") return "图文能力";
  return "仅文字";
}

function percentage(value?: number) {
  return value === undefined ? "—" : `${value}%`;
}

function compactNumber(value?: number) {
  if (value === undefined) return "—";
  if (value >= 10_000)
    return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return value.toLocaleString("zh-CN");
}

export default function PublishingMediaLibraryPage({
  draftId: routeDraftId,
  view = "third",
}: {
  draftId?: string;
  view?: "home" | "third" | "owned" | "cart";
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const draftId =
    routeDraftId ??
    flow?.resources?.find((resource) => resource.kind === "publication_draft")
      ?.id;
  const [location, navigate] = useLocation();
  const search = useSearch();
  const workspaceKey = usePublishingWorkspaceKey();
  const accountShortlistKey = mediaShortlistKey(workspaceKey, search);
  const shortlistKey =
    flow && accountShortlistKey
      ? `${accountShortlistKey}:task:${flow.taskId ?? "new"}`
      : accountShortlistKey;
  const pathname = location || "/publishing/media";
  const routeState = useMemo(() => readMediaRouteState(search), [search]);
  const { filters } = routeState;
  const articleVersionId =
    routeState.articleVersionId ??
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
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [batchQueryDraft, setBatchQueryDraft] = useState(
    filters.batchQuery ?? "",
  );
  const [recommendationDraft, setRecommendationDraft] = useState({
    industry: "",
    product: "",
    region: "",
    audience: "",
    keywords: "",
    budget: "",
    format: "",
  });
  const selectionScope = useMemo(
    () => ({ gateway, shortlistKey, draftId, articleVersionId }),
    [gateway, shortlistKey, draftId, articleVersionId],
  );
  const [selection, setSelection] = useState(() => ({
    scope: selectionScope,
    items: readMediaShortlist(shortlistKey),
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
  const [draftState, setDraftState] = useState<{
    scope: typeof selectionScope;
    value?: PublicationDraft;
  }>();
  const draft =
    draftState?.scope === selectionScope ? draftState.value : undefined;
  const setDraft = useCallback(
    (value?: PublicationDraft) =>
      setDraftState({ scope: selectionScope, value }),
    [selectionScope],
  );
  const [selectionError, setSelectionError] = useState("");
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
  useEffect(() => {
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(Boolean(filters.batchQuery));
  const [businessFiltersOpen, setBusinessFiltersOpen] = useState(false);
  const observedCatalogRevision = useRef<string | undefined>(undefined);
  const [catalogRevisionChange, setCatalogRevisionChange] = useState<{
    previous: string;
    current: string;
  }>();

  const [marketNotice,setMarketNotice]=useState('');
  const [scope, setScope] = useState<'all'|'favorites'|'cart'>('all');
  const [remarkFilter,setRemarkFilter]=useState('');
  const [ruleFilter,setRuleFilter]=useState('');
  const [compact,setCompact]=useState(false);
  const [detailMedia,setDetailMedia]=useState<MediaResource>();
  const favoriteKey=`${accountShortlistKey??workspaceKey}:favorites`;
  const [favoriteState,setFavoriteState]=useState<{key:string;ids:string[]}>({key:'',ids:[]});
  useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(favoriteKey)??'[]');setFavoriteState({key:favoriteKey,ids:Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'):[]});}catch{setFavoriteState({key:favoriteKey,ids:[]});}},[favoriteKey]);
  const favorites=favoriteState.key===favoriteKey?favoriteState.ids:[];
  const favorite=(id:string)=>{const ids=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];try{localStorage.setItem(favoriteKey,JSON.stringify(ids));setFavoriteState({key:favoriteKey,ids});}catch{setSelectionError('收藏保存失败，请检查浏览器存储权限。');}};
  const [dataInfoOpen,setDataInfoOpen]=useState(false);
  const loadMedia = useCallback(
    async (signal: AbortSignal, pageOverride=filters.page):Promise<MediaList> => {
      if(scope==='all'&&!remarkFilter&&!ruleFilter)return gateway.listMedia({...filters,page:pageOverride},signal);
      // Filters derived from official remarks apply to the complete matching
      // directory, before paging. Never relabel one browser page as all results.
      const first=await gateway.listMedia({...filters,page:1,pageSize:100},signal);
      const all=[...first.items];
      for(let page=2;(page-1)*100<first.total;page++){
        const next=await gateway.listMedia({...filters,page,pageSize:100},signal);
        if(next.catalog.activeRevision!==first.catalog.activeRevision)throw new Error('目录在筛选期间已更新，请刷新后重试。');
        all.push(...next.items);
      }
      let matching=all.filter(m=>(scope!=='favorites'||favorites.includes(m.id))&&(scope!=='cart'||selected.has(m.id)));
      if(remarkFilter||ruleFilter){
        const ruleMap=new Map<string,MediaRules>();
        for(let i=0;i<matching.length;i+=100){const data=await rulesRequest<{items:Array<{id:string;rules:MediaRules}>}>('?ids='+encodeURIComponent(matching.slice(i,i+100).map(m=>m.id).join(',')),signal);for(const row of data.items)ruleMap.set(row.id,row.rules);}
        matching=matching.filter(m=>{const rules=ruleMap.get(m.id);return !!rules&&(!remarkFilter||(remarkFilter==='provided'?!!rules.rawRemark:!rules.rawRemark))&&(!ruleFilter||rules.rules.some(r=>r.field===ruleFilter&&r.state==='constrained'));});
      }
      return {...first,total:matching.length,page:pageOverride,pageSize:filters.pageSize,items:matching.slice((pageOverride-1)*filters.pageSize,pageOverride*filters.pageSize)};
    },
    [filters,gateway,scope,favorites.join(','),remarkFilter,ruleFilter,scope==='cart'?[...selected.keys()].join(','):''],
  );
  const loadFacets = useCallback(
    (signal: AbortSignal) => gateway.getMediaFacets(filters, signal),
    [filters, gateway],
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
    `media:${JSON.stringify(filters)}:${scope}:${favorites.join(',')}:${remarkFilter}:${ruleFilter}`,
  );
  const facetsQuery = usePublisherQuery(
    loadFacets,
    `media-facets:${filters.kind}`,
  );
  const articlesQuery = usePublisherQuery(loadArticles, "article-choices");
  const draftQuery = usePublisherQuery(loadDraft, `draft:${draftId ?? "none"}`);

  useEffect(() => {
    const canonical = writeMediaRouteState(pathname, filters, articleVersionId);
    const current = search
      ? `${pathname}?${search.replace(/^\?/u, "")}`
      : pathname;
    if (canonical !== current) navigate(canonical, { replace: true });
  }, [articleVersionId, filters, navigate, pathname, search]);

  useEffect(() => {
    if (
      facetsQuery.data?.catalog.kindComplete === false &&
      filters.kind === "self_media"
    ) {
      navigate(
        writeMediaRouteState(
          pathname,
          { ...filters, kind: "news", page: 1 },
          articleVersionId,
        ),
        { replace: true },
      );
    }
  }, [
    articleVersionId,
    facetsQuery.data?.catalog.kindComplete,
    filters,
    navigate,
    pathname,
  ]);

  useEffect(() => {
    if (!draftQuery.data) {
      setDraft(undefined);
      setSelected(draftId ? new Map() : readMediaShortlist(shortlistKey));
      return;
    }
    setDraft(draftQuery.data);
    if (flow) {
      setBoundDraft(draftQuery.data);
      setConfirmedDraft(draftQuery.data);
    }
    setSelected(
      new Map(draftQuery.data.items.map((item) => [item.media.id, item.media])),
    );
  }, [draftId, draftQuery.data, shortlistKey, setDraft, setSelected]);

  const persistedSelection = flow?.selections?.mediaSelection;
  useEffect(() => {
    if (!flow || draftId || !Array.isArray(persistedSelection)) return;
    const rows = persistedSelection.filter((row): row is MediaResource =>
      Boolean(
        row &&
          typeof row === "object" &&
          typeof row.id === "string" &&
          typeof row.priceTenThousandths === "string",
      ),
    );
    setSelected(new Map(rows.slice(0, 20).map((row) => [row.id, row])));
  }, [draftId, persistedSelection, setSelected]);

  useEffect(() => {
    if (selection.scope === selectionScope && !draftId && !draft)
      saveMediaShortlist(shortlistKey, selected);
  }, [draftId, draft, selected, shortlistKey, selection.scope, selectionScope]);

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
        .reduce((sum, media) => sum + BigInt(media.priceTenThousandths), 0n)
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
  ) => {
    navigate(writeMediaRouteState(nextPath, next, nextVersion));
    void flow?.saveSelections({ mediaFilters: next }).catch(() => undefined);
  };
  const applySmartRecommendation = (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const terms = [
      recommendationDraft.industry,
      recommendationDraft.product,
      recommendationDraft.region,
      recommendationDraft.audience,
      recommendationDraft.keywords,
      recommendationDraft.budget,
      recommendationDraft.format,
    ]
      .map((value) => value.trim())
      .filter(Boolean);
    navigateFilters({
      ...filters,
      query: terms.join(" "),
      recommended: "true",
      page: 1,
    });
  };

  useEffect(() => setQueryDraft(filters.query), [filters.query]);
  useEffect(
    () => setBatchQueryDraft(filters.batchQuery ?? ""),
    [filters.batchQuery],
  );

  useEffect(() => {
    if (queryDraft === filters.query) return;
    const timeout = window.setTimeout(() => {
      navigateFilters({ ...filters, query: queryDraft, page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [filters, queryDraft]);

  useEffect(() => {
    const current = filters.batchQuery ?? "";
    if (batchQueryDraft === current) return;
    const timeout = window.setTimeout(() => {
      navigateFilters({ ...filters, batchQuery: batchQueryDraft, page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [batchQueryDraft, filters]);

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

  const setKind = (kind: PublisherMediaKind) =>
    navigateFilters(switchMediaKind(filters, kind, DEFAULT_MEDIA_FILTERS));

  const persistMediaIds = async (
    mediaIds: string[],
    optimistic: Map<string, MediaResource>,
  ) => {
    if (draftId && !draft) return;
    if ((!articleVersionId || flow) && !draft) {
      if (flow) {
        if (selectionInFlight.current) return;
        selectionInFlight.current = true;
        const generation = selectionGeneration.current;
        setSelectionBusy(true);
        try {
          await flow.saveSelections({
            mediaSelection: [...optimistic.values()],
            mediaFilters: filters,
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
        saveMediaShortlist(shortlistKey, optimistic);
      }
      return;
    }
    if (selectionInFlight.current) return;
    selectionInFlight.current = true;
    const generation = selectionGeneration.current;
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
        const taskId = flow ? await flow.ensureTask() : undefined;
        const requestKey = taskId
          ? await publishingDraftRequestKey(taskId, articleVersionId!, mediaIds)
          : undefined;
        const saved = requestKey
          ? await gateway.createDraft(articleVersionId!, mediaIds, requestKey)
          : await gateway.createDraft(articleVersionId!, mediaIds);
        if (generation !== selectionGeneration.current) return;
        saveMediaShortlist(shortlistKey, new Map());
        setDraft(saved);
        setSelected(
          new Map(saved.items.map((item) => [item.media.id, item.media])),
        );
        navigateFilters(
          filters,
          `/publishing/drafts/${saved.id}/media`,
          articleVersionId,
        );
      }
    } catch (reason) {
      if (generation !== selectionGeneration.current) return;
      if (draft)
        setSelected(
          new Map(draft.items.map((item) => [item.media.id, item.media])),
        );
      else setSelected(optimistic);
      setSelectionError(
        reason instanceof Error ? reason.message : "所选媒体未能保存",
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
    setBoundDraft(undefined);
    const next = new Map(selected);
    if (next.has(media.id)) {
      next.delete(media.id);
      void persistMediaIds([...next.keys()], next);
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
  const currentKindCount =
    filters.kind === "self_media"
      ? mediaQuery.data?.catalog.selfMediaCount
      : mediaQuery.data?.catalog.newsCount;
  const frozenArticles =
    articlesQuery.data?.filter((article) => article.currentVersionId) ?? [];
  const selectedArticle = articlesQuery.data?.find((article) =>
    draft
      ? article.id === draft.articleId
      : article.currentVersionId === articleVersionId,
  );
  const articleHasImages = draft
    ? draft.articleContainsImages
    : Boolean(selectedArticle?.imageCount);
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
      const saved = requestKey
        ? await gateway.createDraft(chosenVersion, mediaIds, requestKey)
        : await gateway.createDraft(chosenVersion, mediaIds);
      if (generation !== selectionGeneration.current) return;
      saveMediaShortlist(shortlistKey, new Map());
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
      } else navigate(`/publishing/drafts/${saved.id}/titles`);
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
    if (selectionInFlight.current || !selected.size) return;
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
      } else if (draft) navigate(`/publishing/drafts/${draft.id}/titles`);
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
  const handoff = async () => {
    if (!flow || !boundDraft || selectionInFlight.current) return;
    if (publishingTarget) {
      const url = new URL(
        projectWorkspaceUrl(`/publishing/drafts/${boundDraft.id}/titles`),
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
        route: `/publishing/drafts/${boundDraft.id}/titles`,
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
  const activeFilterCount = [
    filters.platform,
    filters.taxonomy,
    filters.mediaType,
    filters.area,
    filters.recommended,
    filters.priceMin,
    filters.priceMax,
    filters.includeType,
    filters.publishSpeed,
    filters.entryType,
    filters.linkType,
    filters.pcWeight,
    filters.includeRate,
    filters.successRate,
    filters.authenticated,
    filters.festival,
  ].filter(Boolean).length;
  const recommendedCount = facetCount(
    facetsQuery.data?.recommendedOptions,
    "true",
  );
  const authenticatedCount = facetCount(
    facetsQuery.data?.authenticatedOptions,
    "true",
  );
  const festivalCount = facetCount(
    facetsQuery.data?.festivalPublishableOptions,
    "true",
  );

  const sourceRows=view==='cart'?selectedValues:mediaQuery.data?.items??[];
  const ruleData=useMarketRules([...new Set([...sourceRows.map(x=>x.id),...(detailMedia?[detailMedia.id]:[])])],mediaQuery.data?.catalog.activeRevision??'');
  const rows=ruleData.ready?sourceRows.filter(m=>(scope!=='favorites'||favorites.includes(m.id))&&(!remarkFilter||(remarkFilter==='provided'?!!ruleData.rules[m.id]?.rawRemark:!ruleData.rules[m.id]?.rawRemark))&&(!ruleFilter||ruleData.rules[m.id]?.rules.some(r=>r.field===ruleFilter&&r.state==='constrained'))):[];
  const base=draftId?`/publishing/drafts/${encodeURIComponent(draftId)}/media`:'/publishing/media';
  const titles={home:'媒体库',third:'第三方媒体选择',owned:'自有社媒发布',cart:'第三方购物车'};
  const next=()=>boundDraft&&flow?void handoff():void continueSelection();
  const exportRequest=useRef<AbortController|null>(null),[exporting,setExporting]=useState(false);
  useEffect(()=>{exportRequest.current?.abort();setExporting(false);return()=>exportRequest.current?.abort();},[workspaceKey,JSON.stringify(filters),scope,remarkFilter,ruleFilter]);
  const exportCatalogue=async()=>{if(exporting)return;const abort=new AbortController();exportRequest.current?.abort();exportRequest.current=abort;setExporting(true);try{const first=await loadMedia(abort.signal,1),all=[...first.items];for(let page=2;(page-1)*first.pageSize<first.total;page++){const next=await loadMedia(abort.signal,page);if(next.catalog.activeRevision!==first.catalog.activeRevision)throw new Error('导出期间目录已更新，请重试。');all.push(...next.items);}if(!abort.signal.aborted)exportRows(all);}catch(e){if(!abort.signal.aborted)setSelectionError(e instanceof Error?e.message:'媒体清单导出失败');}finally{if(!abort.signal.aborted)setExporting(false);}};

  return <PublishingPage title={titles[view]} description={view==='third'?'一行一个媒体，横向对比平台、稿件要求和发布备注；勾选即加入购物车。':view==='home'?'从信源研究到媒体选择，再到可回退修正的发布预检。':undefined} busy={selectionBusy} actions={view==='third'?<div className="fm-media"><button className="button secondary" disabled={exporting||!ruleData.ready} onClick={()=>void exportCatalogue()}>{exporting?'正在导出…':'导出媒体清单'}</button></div>:undefined}>
    <div className="fm-media">
      <MediaTaskbar title={(boundDraft??draft)?.articleTitle??selectedArticle?.title} count={selected.size} total={selectedTotal} cartHref={base+'/cart'}>
       <select aria-label="当前投放任务" value={draftId?'current':'research'} onChange={e=>{if(e.target.value==='choose')chooseArticle();else if(e.target.value==='research')navigate(projectWorkspaceUrl('/publishing/media/third'));}}><option value="research">独立浏览 / 研究</option>{draftId&&<option value="current">{draft?.articleTitle??'当前投放任务'}</option>}<option value="choose">选择已确认稿件…</option></select>
       {(draft??boundDraft)&&<button className="link small" onClick={()=>chooseArticle()}>查看 / 更换稿件</button>}
      </MediaTaskbar>
      <MediaTabs active={view} base={base} query={search.replace(/^\?/,'')}/>
      {selectionError&&<p className="notice warn" role="alert">{selectionError}</p>}{marketNotice&&<p className="notice" role="status">{marketNotice}</p>}
      {catalogRevisionChange&&<div className="notice warn">媒体目录已更新，请刷新报价与要求。<button className="link" onClick={refreshChangedCatalog}>刷新目录</button></div>}
      {view==='home'?<><div className="x-source-grid">{[['/publishing/source-matrix','信源矩阵','输入引用记录与行业清单，结合投放需求生成分层推荐。','生成信源推荐'],['/publishing/source-industry','行业信源推荐','按行业查看推荐理由、来源和可投状态；研究信源与可投媒体分别标注。','查看行业推荐'],[base+'/third','第三方媒体','筛选媒体、悬停查看特殊要求，勾选即加入同一购物车。','选择第三方媒体']].map(([href,title,note,cta])=><section className="panel b-entry" key={href}><div className="metric-icon">{title==='信源矩阵'?<Layers3/>:title==='行业信源推荐'?<Search/>:<ShoppingBag/>}</div><h2>{title}</h2><p>{note}</p><Link className="button primary" href={projectWorkspaceUrl(href)}>{cta} →</Link></section>)}</div><div className="x-summary-grid"><div className="x-summary-item"><small>已选第三方媒体</small><strong>{selected.size}</strong><Link className="link small" href={projectWorkspaceUrl(base+'/cart')}>查看购物车 →</Link></div><div className="x-summary-item"><small>已确认费用</small><strong>{formatPublishingMoney(selectedTotal)}</strong><span className="small muted">发布前复核报价</span></div><div className="x-summary-item"><small>已输入引用记录</small><strong>—</strong><Link className="link small" href={projectWorkspaceUrl('/publishing/source-analysis')}>引用信源 →</Link></div><div className="x-summary-item"><small>已输入行业推荐</small><strong>—</strong><Link className="link small" href={projectWorkspaceUrl('/publishing/source-industry')}>行业清单 →</Link></div></div></>:view==='owned'?<section className="panel panel-pad"><h2>自有社媒发布</h2><div className="x-empty"><strong>尚未连接自有账号</strong><p>当前仓库未提供自有社媒账号授权与发布接口。请先完成账号接入；第三方自媒体不会作为自有账号展示。</p></div></section>:view==='cart'?<div className="y-catalogue">
       <div className="actions" style={{marginBottom:18}}><Link className="button secondary" href={projectWorkspaceUrl(base+'/third')}>← 继续选择媒体</Link><button className="button quiet" onClick={()=>exportRows(selectedValues)}>导出清单</button><button className="button quiet" disabled={!selected.size} onClick={()=>{try{const key=`${accountShortlistKey??workspaceKey}:templates`;const saved=JSON.parse(localStorage.getItem(key)??'[]');localStorage.setItem(key,JSON.stringify([...(Array.isArray(saved)?saved:[]),{savedAt:new Date().toISOString(),mediaIds:selectedValues.map(m=>m.id)}].slice(-20)));setMarketNotice('当前组合模板已保存在此浏览器。重新使用前需复核媒体报价与要求。');}catch{setSelectionError('组合模板保存失败，请检查浏览器存储权限。');}}}>保存组合模板</button><button className="link danger" onClick={clearSelection}>清空购物车</button></div>
       {!draft&&!boundDraft&&<div className="notice" style={{marginBottom:16}}>当前是独立研究清单。配置标题前，请绑定已确认稿件；清单与报价会一并保留。</div>}
       {ruleData.error&&<p className="notice warn" role="status">{ruleData.error}</p>}
       <div className="panel y-cart-panel">{ruleData.ready&&selected.size?<div className="table-wrap"><table className="y-cart-table"><thead><tr><th>媒体 / 发布备注</th><th>单篇报价</th><th>投放稿件</th><th>规则与操作</th></tr></thead><tbody>{selectedValues.map(m=><tr key={m.id}><td className="y-cart-resource"><strong>{m.name}</strong><p className="small muted">{m.platform||'平台未注明'}</p><div className="y-remarks-line"><span>发布备注</span><PublishingRemark text={ruleData.rules[m.id]?.rawRemark??m.remark}/></div></td><td><strong className="b-price">{formatPublishingMoney(m.priceTenThousandths)}</strong><p className="small muted">目录报价 · 发布前复核</p></td><td><label><input type="checkbox" checked={!!(draft??boundDraft)} disabled/>{(draft??boundDraft)?.articleTitle??'尚未绑定稿件'}</label><button className="link small" onClick={()=>chooseArticle()}>选择 / 更换稿件</button></td><td><button className="link small" onClick={()=>setDetailMedia(m)}>要求与预检</button><button className="link small" disabled={selectionBusy} onClick={()=>toggle(m)}>移除</button></td></tr>)}</tbody></table></div>:<div className="x-empty"><strong>{ruleData.loading?'正在读取目录资料':!ruleData.ready?'等待官方 API 配置':'购物车还没有媒体'}</strong><p>从第三方媒体或信源矩阵中选择资源。</p></div>}</div>
       <div className="b-bottom"><div><strong>购物车 {selected.size} 家 · {formatPublishingMoney(selectedTotal)}</strong><p className="small muted">发布前按实际稿件与媒体组合重新核对费用。</p></div><div className="actions"><button className="button secondary" onClick={()=>chooseArticle()}>绑定已确认稿件</button><button className="button primary" disabled={!selected.size||selectionBusy} onClick={next}>配置标题 →</button></div></div>
      </div>:<div className={'y-catalogue '+(compact?'y-compact':'')}>
       <div className="y-data-strip"><span><strong>{ruleData.loading?'正在读取官方目录状态':ruleData.ready?`已载入 ${sourceRows.length} 条目录记录`:'官方 API 待配置'}</strong>　备注悬停可展开；未提供的要求保留为待确认。</span><button className="link" onClick={()=>setDataInfoOpen(true)}>数据说明 ⓘ</button></div>
       {ruleData.error&&<p className="notice warn fm-status" role="status">{ruleData.error}</p>}
       {view==='third'&&<>
       <section className={'panel y-filter-panel '+(advancedOpen?'':'y-filter-collapsed')}>
        <div className="y-search-line"><div className="y-search-box"><Search size={18}/><input type="search" className="field" aria-label="搜索媒体" value={queryDraft} placeholder="搜索媒体、平台或资源编号" onChange={e=>setQueryDraft(e.target.value)}/></div><button className="button secondary x-small-button" onClick={()=>setBatchOpen(!batchOpen)}>批量搜索</button><select aria-label="媒体排序" value={filters.sort??'recommended'} onChange={e=>updateFilter('sort',e.target.value as MediaFilters['sort'])}><option value="recommended">按目录顺序</option><option value="price_asc">报价从低到高</option><option value="price_desc">报价从高到低</option></select><button className="button secondary x-small-button" aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(!advancedOpen)}>{advancedOpen?'收起筛选 ▴':'筛选条件 ▾'}</button><button className="link small" onClick={()=>{navigateFilters({...DEFAULT_MEDIA_FILTERS,kind:filters.kind});setRemarkFilter('');setRuleFilter('');}}>重置</button></div>
        {batchOpen&&<textarea className="field" aria-label="批量搜索媒体" value={batchQueryDraft} onChange={e=>setBatchQueryDraft(e.target.value)} placeholder="每行一个媒体名称或资源编号"/>}
        <div className="y-filter-line"><span className="y-filter-label">媒体平台</span><div className="y-chip-options"><button className={!filters.platform?'active':''} onClick={()=>updateFilter('platform','')}>全部</button>{facetsQuery.data?.platforms.map(p=><button key={p.value} className={filters.platform===p.value?'active':''} onClick={()=>updateFilter('platform',p.value)}>{p.label}<small>{p.count}</small></button>)}</div></div>
        <div className="y-filter-line"><span className="y-filter-label">备注状态</span><div className="y-chip-options">{[['','全部'],['provided','有发布备注'],['unknown','未注明备注']].map(([v,t])=><button key={v} className={remarkFilter===v?'active':''} onClick={()=>{setRemarkFilter(v);updateFilter('page',1);}}>{t}</button>)}</div></div>
        <div className="y-filter-line"><span className="y-filter-label">发布条件</span><div className="y-chip-options">{[['','全部'],['title_chars','标题限制'],['body_chars','正文限制'],['images','图片限制'],['links','链接限制']].map(([v,t])=><button key={v} className={ruleFilter===v?'active':''} onClick={()=>{setRuleFilter(v);updateFilter('page',1);}}>{t}</button>)}</div></div>
        <details className="y-more"><summary>更多条件：行业、报价与稿件适配</summary><div className="x-filter-grid"><label>行业<select value={filters.taxonomy??''} onChange={e=>updateFilter('taxonomy',e.target.value)}><option value="">全部行业</option>{facetsQuery.data?.taxonomies.map(p=><option value={p.value} key={p.value}>{p.label}</option>)}</select></label><label>最低价（元 / 篇）<input className="field" value={filters.priceMin??''} inputMode="decimal" onChange={e=>updateFilter('priceMin',e.target.value)}/></label><label>最高价（元 / 篇）<input className="field" value={filters.priceMax??''} inputMode="decimal" onChange={e=>updateFilter('priceMax',e.target.value)}/></label><label>素材能力<select value={filters.capability??''} onChange={e=>updateFilter('capability',e.target.value as MediaFilters['capability'])}><option value="">不限</option><option value="image">支持图文</option><option value="text">仅文字</option></select></label></div><p className="y-subtle-note">平台、行业与价格筛选查询真实目录；备注与结构化要求在完整匹配目录中筛选后分页。</p></details>
       </section>
       <div className="y-resultbar"><div className="y-result-tabs">{[['all','全部'],['favorites','我的收藏'],['cart','购物车']].map(([v,t])=><button key={v} className={scope===v?'active':''} onClick={()=>{setScope(v as typeof scope);updateFilter('page',1);}}>{t}<small>{v==='cart'?selected.size:v==='favorites'?favorites.length:mediaQuery.data?.total??'—'}</small></button>)}</div><span className="y-result-count">为您找到 <strong>{mediaQuery.data?.total??'—'}</strong> 条媒体资源</span></div>
       <div className="y-typebar"><button className={!filters.kind?'active':''} onClick={()=>navigateFilters({...filters,kind:undefined,page:1})}>全部媒体</button><button className={filters.kind==='news'?'active':''} onClick={()=>navigateFilters({...filters,kind:'news',page:1})}>门户媒体</button><button className={filters.kind==='self_media'?'active':''} onClick={()=>navigateFilters({...filters,kind:'self_media',page:1})}>第三方自媒体</button></div>
       </>}
       <div className="y-selection"><label><input type="checkbox" aria-label="本页全选" checked={rows.length>0&&rows.every(m=>selected.has(m.id))} disabled={selectionBusy||!rows.length} onChange={e=>{const next=new Map(selected);for(const m of rows){if(e.target.checked){if(next.size<20&&!mediaSelectionBlocker(m,articleHasImages))next.set(m.id,m);}else next.delete(m.id);}setBoundDraft(undefined);void persistMediaIds([...next.keys()],next);}}/>本页全选 <span> | </span><strong>已选 {selected.size} 家</strong></label><div className="actions"><button className="link" onClick={()=>{const ids=[...new Set([...favorites,...selectedValues.map(m=>m.id)])];try{localStorage.setItem(favoriteKey,JSON.stringify(ids));setFavoriteState({key:favoriteKey,ids});}catch{setSelectionError('收藏保存失败');}}}>批量收藏</button><button className="link" onClick={()=>exportRows(selectedValues)}>导出已选</button><button className="link" onClick={clearSelection}>清空已选</button><button className="link" onClick={()=>setCompact(!compact)}>{compact?'展开信息':'精简信息'}</button></div></div>
       {mediaQuery.loading&&<PublishingLoading label="正在读取媒体目录…"/>}{mediaQuery.error&&<PublishingError error={mediaQuery.error} onRetry={mediaQuery.reload}/>}
       <div className="y-horizontal-scroll"><RowHead/><div className="y-media-list">{rows.map(media=><MarketRow key={media.id} media={media} rules={ruleData.rules[media.id]} checked={selected.has(media.id)} favorite={favorites.includes(media.id)} onFavorite={()=>favorite(media.id)} onToggle={()=>toggle(media)} disabled={selectionBusy||Boolean(draftId&&!draft)||(!selected.has(media.id)&&(!!mediaSelectionBlocker(media,articleHasImages)||selected.size>=20))} onDetails={()=>setDetailMedia(media)}/>)}{!rows.length&&!ruleData.loading&&<div className="x-empty"><strong>{ruleData.ready?'没有匹配的媒体':'等待官方 API 配置'}</strong><p>{ruleData.ready?'调整平台、关键词或其他条件后再试。已选媒体保持不变。':'完成服务端凭据和目录同步后，将直接在此列表显示真实媒体与发布要求。'}</p></div>}</div></div>
       {view==='third'&&scope!=='cart'&&<div className="y-pages"><span>共 {mediaQuery.data?.total??'—'} 家 · 第 {filters.page} / {pageCount} 页　<select aria-label="每页媒体数" value={filters.pageSize} onChange={e=>updateFilter('pageSize',Number(e.target.value))}>{[10,20,50].map(n=><option key={n} value={n}>{n} 家 / 页</option>)}</select></span><PublishingPagination page={filters.page} pageCount={pageCount} onChange={page=>updateFilter('page',page)}/></div>}
       <p className="y-list-footnote">报价与要求来自官方目录。无法解析的备注须人工核验，不作收录或 AI 引用承诺。</p>
       <div className="b-bottom"><div><strong>购物车 {selected.size} 家 · {formatPublishingMoney(selectedTotal)}</strong><p className="small muted">勾选即加入，取消勾选即移除。发布前重新核对报价与稿件。</p></div><div className="actions"><Link className="button secondary" href={projectWorkspaceUrl(base+'/cart')}>查看购物车</Link><button className="button primary" disabled={!selected.size||selectionBusy} onClick={next}>配置标题 →</button></div></div>
      </div>}
      <PublishingConfirmDialog open={dataInfoOpen} title="媒体数据说明" description="列表使用官方 API 同步的媒体档案，不是演示库存。" confirmLabel="关闭" onCancel={()=>setDataInfoOpen(false)} onConfirm={()=>setDataInfoOpen(false)}><div className="fm-media"><div className="y-info-metrics"><div><strong>{mediaQuery.data?.total??'—'}</strong><span>匹配媒体记录</span></div><div><strong>{sourceRows.length}</strong><span>当前页记录</span></div><div><strong>{sourceRows.filter(m=>!!ruleData.rules[m.id]?.rawRemark).length}</strong><span>当前页有备注</span></div><div><strong>{selected.size}</strong><span>已选媒体</span></div></div><div className="reading"><p>原始发布备注与解析规则以媒体内部 ID 关联，同名媒体与跨平台账号不合并。无法解析的文字保留为待核验。</p><p>报价来自仓库既有官方目录同步链路；规则从当前档案的原始备注或最新采集快照解析。没有报价、地区、权重与引用监测的字段，不使用参考稿的示例值填充。</p><p>目录更新后须重新核对选择、标题与稿件。正式下单继续使用现有业务的实时重报价和发布预检。</p></div></div></PublishingConfirmDialog>
      <MediaDetails media={detailMedia} rules={detailMedia?ruleData.rules[detailMedia.id]:undefined} onClose={()=>setDetailMedia(undefined)}/>
    </div>
      <PublishingConfirmDialog
        inline={Boolean(flow)}
        open={articleChooserOpen}
        title={draft ? "更换发布稿件" : "选择发布稿件"}
        description={
          draft
            ? "已选媒体将复制到新的投放草稿，标题重新配置，原草稿保留。"
            : "选择已确认的稿件版本，系统将重新核对媒体报价与内容要求。"
        }
        confirmLabel={
          selected.size
            ? flow
              ? "确认稿件与媒体"
              : "绑定稿件并配置标题"
            : "使用这篇稿件"
        }
        busy={selectionBusy}
        confirmDisabled={!chosenVersion}
        onCancel={() => setArticleChooserOpen(false)}
        onConfirm={() => void bindArticle()}
      >
        {articlesQuery.loading ? (
          <PublishingLoading label="正在加载稿件…" />
        ) : null}
        {articlesQuery.error ? (
          <PublishingError
            error={articlesQuery.error}
            onRetry={articlesQuery.reload}
          />
        ) : null}
        <label className="publishing-article-choice">
          <span>稿件及版本</span>
          <select
            aria-label="选择冻结稿件"
            value={chosenVersion}
            onChange={(event) => setChosenVersion(event.target.value)}
            disabled={selectionBusy || Boolean(draftId && !draft)}
          >
            <option value="">请选择稿件</option>
            {frozenArticles.map((article) => (
              <option
                key={article.currentVersionId}
                value={article.currentVersionId}
              >
                {article.title} · v{article.currentVersion}
              </option>
            ))}
          </select>
        </label>
        {!articlesQuery.loading && !frozenArticles.length ? (
          <p>
            暂时没有已确认版本的稿件。
            <Link href="/publishing/articles">前往稿件管理</Link>
          </p>
        ) : null}
        {selectionError ? (
          <p className="publishing-inline-error" role="alert">
            {selectionError}
          </p>
        ) : null}
      </PublishingConfirmDialog>
    </PublishingPage>;
}
function FilterLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="publishing-filter-line">
      <strong>{label}</strong>
      {children}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options?: Array<{ value: string; label: string; count: number }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="publishing-inline-select">
      <span className="publishing-visually-hidden">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{label}</option>
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function ThresholdSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options?: Array<{ value: string; label: string; count: number }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">不限</option>
        {options
          ?.filter((option) => option.count > 0)
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
      </select>
    </label>
  );
}

function facetCount(
  options: Array<{ value: string; count: number }> | undefined,
  value: string,
) {
  if (!options) return undefined;
  return options.find((option) => option.value === value)?.count ?? 0;
}

function capabilityFacetOptions(
  options: Array<{ value: string; label: string; count: number }> | undefined,
) {
  return (options ?? [])
    .filter((option) => option.count > 0)
    .map((option) => ({
      ...option,
      value:
        option.value === "verified"
          ? "image"
          : option.value === "unsupported"
            ? "text"
            : "image_pending",
    }));
}
