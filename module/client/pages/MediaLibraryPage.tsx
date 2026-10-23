import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import { MarketRow, RowHead, MediaDialog, MediaShell, MediaCartFooter, MediaTaskbar, MediaDetails, useMarketRules, exportRows, rulesRequest } from "../source-matrix/MediaMarket";
import PublishingFlowSteps, { flowStagesForMode, titleModeForFlowMode, type FlowStageMode } from "../components/PublishingFlowSteps";
import "../publishing.market.css";
import {ReferenceIcon,ReferenceInlineIcon} from "../source-matrix/ReferenceIcons";
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
  switchMediaKind,
} from "../mediaShortlist";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import {
  PublishingQuestion,
  usePublishingChoice,
} from "../components/PublishingConversation";
import {
  DEFAULT_MEDIA_FILTERS,
  parseBatchQuery,
  readMediaRouteState as readSharedMediaRouteState,
  writeMediaRouteState as writeSharedMediaRouteState,
} from "../queryState";
import {
  formatPublishingMoney,
  type MediaList,
  type MediaFilters,
  type MediaResource,
  type PublicationDraft,
  type PublisherMediaKind,
} from "../types";

// This catalogue's all-media tab is explicit; other publishing screens keep their existing news default.
function readMediaRouteState(search:string) {const state=readSharedMediaRouteState(search);if(new URLSearchParams(search).get('kind')==='all')state.filters.kind=undefined;return state;}
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
  const draftId =
    routeDraftId ??
    flow?.resources?.find((resource) => resource.kind === "publication_draft")
      ?.id;
  const [location, navigate] = useLocation();
  const search = useSearch();
  // Keep the server-side matrix task in links; no browser persistence or
  // replacement data store is needed to return from the real draft cart.
  const matrixTask = new URLSearchParams(search).get('matrixTask') ?? '';
  const writeMediaRouteState = (path:string,next:MediaFilters,version?:string) => {
    const serialized=writeMediaRouteFilters(path,next,version);
    if(!matrixTask)return serialized;
    const [pathname,query]=serialized.split('?'),params=new URLSearchParams(query);
    params.set('matrixTask',matrixTask);return pathname+'?'+params.toString();
  };
  const pageHref=(path:string)=>matrixTask?path+(path.includes('?')?'&':'?')+'matrixTask='+encodeURIComponent(matrixTask):path;
  const sourceHref=(path:string)=>{const params=new URLSearchParams();if(draftId)params.set('draftId',draftId);if(matrixTask)params.set('task',matrixTask);return path+(params.size?'?'+params.toString():'');};
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
  const favorites:string[]=[];
  const favorite=(_id:string)=>setMarketNotice('收藏接口尚未配置，未保存本次收藏。');
  const [dialogMessage,setDialogMessage]=useState('');
  const [previewOpen,setPreviewOpen]=useState(false),[mobilePreview,setMobilePreview]=useState(false);
  const [selectionReason,setSelectionReason]=useState('');
  const [quoteMedia,setQuoteMedia]=useState<MediaResource>();
  const [quotePrice,setQuotePrice]=useState(''),[quoteSource,setQuoteSource]=useState(''),[quoteAck,setQuoteAck]=useState(false),[quoteError,setQuoteError]=useState('');
  const [templateOpen,setTemplateOpen]=useState(false),[templateName,setTemplateName]=useState(''),[templateError,setTemplateError]=useState('');
  const [quoteStatus,setQuoteStatus]=useState('');
  const [clientSort,setClientSort]=useState('match');
  const [dataInfoOpen,setDataInfoOpen]=useState(false);
  const loadMedia = useCallback(
    async (signal: AbortSignal, pageOverride=filters.page):Promise<MediaList> => {
      if(scope==='all'&&!remarkFilter&&!ruleFilter&&!quoteStatus&&clientSort!=='name'&&clientSort!=='remark')return gateway.listMedia({...filters,page:pageOverride},signal);
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
      if(remarkFilter||ruleFilter||clientSort==='remark'){
        const ruleMap=new Map<string,MediaRules>();
        for(let i=0;i<matching.length;i+=100){const data=await rulesRequest<{items:Array<{id:string;rules:MediaRules}>}>('?ids='+encodeURIComponent(matching.slice(i,i+100).map(m=>m.id).join(',')),signal);for(const row of data.items)ruleMap.set(row.id,row.rules);}
        matching=matching.filter(m=>{const rules=ruleMap.get(m.id);return !!rules&&(!remarkFilter||(remarkFilter==='provided'?!!rules.rawRemark:remarkFilter==='unknown'?!rules.rawRemark:false))&&(!ruleFilter||(ruleFilter==='weekend'?/周末可发/.test(rules.rawRemark??''):/节假日可发/.test(rules.rawRemark??'')));});
        if(clientSort==='remark')matching.sort((a,b)=>Number(!!ruleMap.get(b.id)?.rawRemark)-Number(!!ruleMap.get(a.id)?.rawRemark));
      }
      matching=matching.filter(m=>!quoteStatus||(quoteStatus==='inquiry'?(!/^\d+$/.test(m.priceTenThousandths)||BigInt(m.priceTenThousandths)<=0n):false));
      if(clientSort==='name')matching.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
      
      return {...first,total:matching.length,page:pageOverride,pageSize:filters.pageSize,items:matching.slice((pageOverride-1)*filters.pageSize,pageOverride*filters.pageSize)};
    },
    [filters,gateway,scope,favorites.join(','),remarkFilter,ruleFilter,quoteStatus,clientSort,scope==='cart'?[...selected.keys()].join(','):''],
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
    `media:${JSON.stringify(filters)}:${scope}:${favorites.join(',')}:${remarkFilter}:${ruleFilter}:${quoteStatus}:${clientSort}`,
  );
  const facetsQuery = usePublisherQuery(
    loadFacets,
    `media-facets:${filters.kind}`,
  );
  const articlesQuery = usePublisherQuery(loadArticles, "article-choices");
  const draftQuery = usePublisherQuery(loadDraft, `draft:${draftId ?? "none"}`);

  // 编辑器带来的投放模式参数参与 URL 规范化，刷新/返回后流程条仍显示正确阶段数。
  const routeModeParam = new URLSearchParams(search.replace(/^\?/u, "")).get(
    "mode",
  );
  const carriedMode =
    routeModeParam === "single" ||
    routeModeParam === "multi" ||
    routeModeParam === "batch"
      ? `&mode=${routeModeParam}`
      : "";
  useEffect(() => {
    const canonical =
      writeMediaRouteState(pathname, filters, articleVersionId) + carriedMode;
    const current = search
      ? `${pathname}?${search.replace(/^\?/u, "")}`
      : pathname;
    if (canonical !== current) navigate(canonical, { replace: true });
  }, [
    articleVersionId,
    carriedMode,
    filters,
    navigate,
    pathname,
    search,
  ]);

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
      setSelected(draftId ? new Map() : new Map<string, MediaResource>());
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
  const rows=ruleData.ready?sourceRows:[];
  const base=draftId?`/publishing/drafts/${encodeURIComponent(draftId)}/media`:'/publishing/media';
  const task=boundDraft??draft;
  // 统一流程条：以草稿 titleMode 为准；建稿前沿用编辑器带来的模式参数；独立浏览默认 4 步初始展示。
  const flowModeParam=new URLSearchParams(search.replace(/^\?/u, "")).get("mode");
  const flowMode:FlowStageMode=task?.titleMode==="single"?"single":task?.titleMode==="per_media"?"per_media":flowModeParam==="single"?"single":flowModeParam==="multi"?"multi":flowModeParam==="batch"?"batch":"default";
  const hasArticleContext=Boolean(task||articleVersionId||draftId);
  const flowSteps=<PublishingFlowSteps stages={flowStagesForMode(flowMode)} doneCount={hasArticleContext?1:0} activeIndex={hasArticleContext?1:0}/>;
  const next=()=>{if(!hasArticleContext)return;if(boundDraft&&flow)void handoff();else void continueSelection();};
  const exportRequest=useRef<AbortController|null>(null),[exporting,setExporting]=useState(false);
  useEffect(()=>{exportRequest.current?.abort();setExporting(false);return()=>exportRequest.current?.abort();},[workspaceKey,JSON.stringify(filters),scope,remarkFilter,ruleFilter]);
  const exportCatalogue=async()=>{if(exporting)return;const abort=new AbortController();exportRequest.current?.abort();exportRequest.current=abort;setExporting(true);try{const first=await loadMedia(abort.signal,1),all=[...first.items];for(let page=2;(page-1)*first.pageSize<first.total;page++){const next=await loadMedia(abort.signal,page);if(next.catalog.activeRevision!==first.catalog.activeRevision)throw new Error('导出期间目录已更新，请重试。');all.push(...next.items);}if(!abort.signal.aborted)exportRows(all);}catch(e){if(!abort.signal.aborted)setDialogMessage(e instanceof Error?e.message:'媒体清单导出失败');}finally{if(!abort.signal.aborted)setExporting(false);}};
  const reset=()=>{navigateFilters({...DEFAULT_MEDIA_FILTERS,kind:undefined});setRemarkFilter('');setRuleFilter('');setQuoteStatus('');setScope('all');setClientSort('match');};
  const pending=selectedValues.filter(m=>!/^\d+$/.test(m.priceTenThousandths)||BigInt(m.priceTenThousandths)<=0n).length;
  const nextLabel=flowMode==="single"?"预检发布":"配置标题";
  const footer=<MediaCartFooter count={selected.size} total={selectedTotal} pending={pending} cartHref={pageHref(base+'/cart')} onNext={next} nextLabel={nextLabel} nextDisabled={!hasArticleContext} nextHint={hasArticleContext?undefined:"您还未选择稿件"} articlesHref={hasArticleContext?undefined:projectWorkspaceUrl('/publishing/articles')}/>;
  useEffect(()=>{if(articleChooserOpen&&!chosenVersion&&frozenArticles[0]?.currentVersionId)setChosenVersion(frozenArticles[0].currentVersionId);},[articleChooserOpen,chosenVersion,frozenArticles,setChosenVersion]);
  const chips=(value:string,items:Array<[string,string,number?]>,onChange:(value:string)=>void)=><div className="y-chip-options">{items.map(([v,t,n])=><button key={v} className={value===v?'active':''} onClick={()=>onChange(v)}>{t}{n!==undefined&&<small>{n}</small>}</button>)}</div>;
  const total=mediaQuery.data?.total??0;
  return <MediaShell steps={flowSteps} title={view==='home'?'媒体库':view==='cart'?'第三方购物车':'第三方媒体选择'} notice={view==='home'?<div className="notice x-home-notice">矩阵先按问题与媒体适配生成；填写预算后，再推荐组合。两种选媒方式共用一个购物车。</div>:undefined} note={view==='home'?'分析信源、比较媒体，统一管理本次投放清单。':view==='cart'?'逐篇分配投放稿件；报价缺失单独标记，不参与已确认金额合计。':'一行一个媒体，横向对比平台、稿件要求和发布备注；勾选即加入购物车。'} actions={view==='third'||view==='owned'?<button className="button secondary" onClick={()=>void exportCatalogue()}><ReferenceIcon name="download"/>导出媒体清单</button>:view==='home'&&task?<span className="x-task-pill" title={task.articleTitle}>任务：{task.articleTitle} · 稿件 v{task.articleVersion}</span>:undefined} taskbar={<MediaTaskbar note={task?`稿件：单篇发布 · 1 篇 · 已确认 v${task.articleVersion}`:undefined} saveStatus={selectionBusy?'正在保存…':task?'已读取投放草稿':''} title={task?(view==='home'?'当前任务：':'')+task.articleTitle:undefined} count={selected.size} total={selectedTotal} cart={view!=='home'} cartHref={pageHref(base+'/cart')} actions={task&&<><button className="link small" onClick={()=>setPreviewOpen(true)}>查看稿件</button><Link className="link small" href={projectWorkspaceUrl('/publishing/articles/'+encodeURIComponent(task.articleId)+'/edit')}>返回编辑</Link></>}><select aria-label="当前投放任务" value={draftId?'current':'research'} onChange={e=>{if(e.target.value==='research')navigate(projectWorkspaceUrl('/publishing/media/third'));}}><option value="research">独立浏览 / 研究</option>{draftId&&<option value="current">{draft?.articleTitle??'已确认稿件'}</option>}</select></MediaTaskbar>}>
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
    <div className="x-cart-metrics"><strong>{selected.size} 家 · {formatPublishingMoney(selectedTotal)}</strong><span className="small muted">已确认选择 · {pending} 项费用待确认</span></div>
    <Link className="button secondary" href={projectWorkspaceUrl(pageHref(base+'/cart'))}>查看购物车 →</Link>
  </section>
  <p className="footer-note">媒体、报价与发布要求来自已配置的供应商接口；不保证收录或 AI 引用。</p>
</>:view==='cart'?<>
   <div className="actions" style={{marginBottom:18}}><Link className="button secondary" href={projectWorkspaceUrl(pageHref(base+'/third'))}>← 继续选择媒体</Link><button className="button quiet" onClick={()=>exportRows(selectedValues)}>导出清单</button><button className="button quiet" onClick={()=>{setTemplateError('');setTemplateOpen(true);}}>保存组合模板</button><button className="link danger" onClick={()=>setDialogMessage('clear')}>清空购物车</button></div>
   {!task&&<div className="notice" style={{marginBottom:16}}>当前是独立研究清单。配置标题前，请绑定已确认稿件；清单与报价会一并保留。</div>}
   {catalogRevisionChange&&<div className="notice warn" style={{marginBottom:16}}>稿件版本发生变化。<button className="link" onClick={refreshChangedCatalog}>确认当前版本与映射</button></div>}
   <div className="panel y-cart-panel">{selected.size?<div className="table-wrap"><table className="y-cart-table"><thead><tr><th>媒体 / 发布备注</th><th>单篇报价</th><th>投放稿件</th><th>规则与操作</th></tr></thead><tbody>{selectedValues.map(m=><tr key={m.id}><td className="y-cart-resource"><strong>{m.name}</strong><p className="y-subtle-note" style={{margin:'4px 0'}}>{m.platform} · {m.id}</p><div className="y-remarks-line"><span>发布备注</span><PublishingRemark text={ruleData.rules[m.id]?.rawRemark??m.remark} media={m} rules={ruleData.rules[m.id]}/></div></td><td><strong className="b-price">{formatPublishingMoney(m.priceTenThousandths)}</strong><p className="y-subtle-note">目录报价 · 发布前复核</p><button className="link" onClick={()=>{setQuoteError('');setQuoteMedia(m);}}>查看 / 修改报价</button></td><td>{task?<label><input type="checkbox" checked onChange={()=>setDialogMessage('当前投放草稿按稿件保存媒体；请通过任务选择更换稿件。')}/><span>文章 1 · {task.articleTitle} · v{task.articleVersion}</span></label>:<span className="small muted">尚未绑定稿件</span>}</td><td><div className="actions"><button className="link" onClick={()=>setDetailMedia(m)}>资料详情</button><button className="link" onClick={()=>setDetailMedia(m)}>投稿要求</button></div><button className="link danger" style={{marginTop:8}} onClick={()=>toggle(m)}>移除</button></td></tr>)}</tbody></table></div>:<div className="empty"><div className="metric-icon"><ReferenceIcon name="file"/></div><h2>购物车还没有媒体</h2><p>勾选媒体即可加入，原始备注与规则会一并带入。</p><div className="actions"><Link className="button primary" href={projectWorkspaceUrl(pageHref(base+'/third'))}>浏览媒体</Link></div></div>}</div>
   <label className="label" style={{marginTop:20}}>渠道选择理由</label><textarea placeholder="说明本次选择这些媒体的依据" value={selectionReason} onChange={e=>setSelectionReason(e.target.value)} onBlur={()=>{if(selectionReason)setDialogMessage('渠道选择理由保存接口尚未配置，本次输入尚未保存。');}}/><p className="y-subtle-note">已知小计 {formatPublishingMoney(selectedTotal)}；另有 {pending} 项报价 / 状态待确认。配置标题后可以先检查正文，未确认报价和未完成人工复核的项目无法提交。</p>{footer}
  </>:<div className={'y-catalogue '+(compact?'y-compact':'')}>
   <div className="y-data-strip"><span><strong>{mediaQuery.loading?'正在读取媒体目录':`已载入 ${total} 条目录记录`}</strong>　备注悬停可展开；未提供的报价与要求保留为待确认。</span><button className="link" onClick={()=>setDataInfoOpen(true)}>数据说明 <ReferenceIcon name="info"/></button></div>
   <section className={'panel y-filter-panel '+(advancedOpen?'':'y-filter-collapsed')}><div className="y-search-line"><div className="y-search-box"><ReferenceInlineIcon name="search"/><input type="search" className="field" id="b-search" aria-label="搜索媒体" value={queryDraft} placeholder="搜索媒体、平台、域名或发布备注" onChange={e=>setQueryDraft(e.target.value)}/></div><button className="button secondary x-small-button" onClick={()=>setBatchOpen(true)}>批量搜索</button><select aria-label="媒体排序" value={clientSort} onChange={e=>{setClientSort(e.target.value);if(e.target.value==='priceAsc'||e.target.value==='priceDesc')updateFilter('sort',e.target.value==='priceAsc'?'price_asc':'price_desc');else updateFilter('sort','recommended');}}>{[['match','按抓取顺序'],['remark','有备注优先'],['priceAsc','报价从低到高'],['priceDesc','报价从高到低'],['name','按媒体名称']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select><button className="button secondary x-small-button" aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(!advancedOpen)}>{advancedOpen?'收起筛选 ▴':'筛选条件 ▾'}</button><button className="link small" onClick={reset}>重置</button></div>
   <div className="y-filter-line"><span className="y-filter-label">媒体平台</span>{chips(filters.platform??'',[['','全部',total],...(facetsQuery.data?.platforms??[]).map(p=>[p.value,p.label,p.count] as [string,string,number])],v=>updateFilter('platform',v))}</div>
   <div className="y-filter-line"><span className="y-filter-label">备注状态</span>{chips(remarkFilter,[['','全部'],['provided','有发布备注'],['unknown','未注明备注'],['failed','抓取异常 / 已补全']],v=>{setRemarkFilter(v);if(v==='failed')setDialogMessage('当前接口未提供原始抓取失败标记，暂无可核验的异常记录。');updateFilter('page',1);})}</div>
   <div className="y-filter-line"><span className="y-filter-label">发布条件</span>{chips(ruleFilter,[['','全部'],['weekend','备注提到周末可发'],['holiday','备注提到节假日可发']],v=>{setRuleFilter(v);updateFilter('page',1);})}</div>
   <details className="y-more"><summary>更多条件：行业、报价与稿件适配</summary><div className="x-filter-grid"><label>行业<select value={filters.taxonomy??''} onChange={e=>updateFilter('taxonomy',e.target.value)}><option value="">全部行业</option>{facetsQuery.data?.taxonomies.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label><label>报价状态<select value={quoteStatus} onChange={e=>{setQuoteStatus(e.target.value);if(e.target.value==='available')setDialogMessage('当前接口未提供人工报价记录，无法将目录报价标为人工录入。');updateFilter('page',1);}}><option value="">全部状态</option><option value="inquiry">待询价</option><option value="available">已人工录入报价</option></select></label><label>最低价（元 / 篇）<input className="field" type="number" min="0" value={filters.priceMin??''} placeholder="未设置" onChange={e=>updateFilter('priceMin',e.target.value)}/></label><label>最高价（元 / 篇）<input className="field" type="number" min="0" value={filters.priceMax??''} placeholder="未设置" onChange={e=>updateFilter('priceMax',e.target.value)}/></label></div><p className="y-subtle-note">筛选依据为供应商目录。报价未知的媒体不参与数值价格筛选；“出稿快”等仅为备注原文，不换算成小时数。</p></details></section>
   <div id="y-results" className="y-resultbar"><div className="y-result-tabs">{[['all','全部',total],['favorites','我的收藏',favorites.length],['cart','购物车',selected.size]].map(([v,t,n])=><button key={v} className={scope===v?'active':''} onClick={()=>{if(v==='favorites')setDialogMessage('收藏接口尚未配置，无法读取收藏清单。');setScope(v as typeof scope);updateFilter('page',1);}}>{t}<small>{n}</small></button>)}</div><span className="y-result-count" id="y-result-count">为您找到 <strong>{total}</strong> 条媒体资源</span></div>
   <div className="y-typebar">{[['','全部媒体',total],['news','门户媒体',facetsQuery.data?.kinds.news??0],['self_media','第三方自媒体',facetsQuery.data?.kinds.self_media??0]].map(([v,t,n])=><button key={v} className={(filters.kind??'')===v?'active':''} onClick={()=>navigateFilters({...filters,kind:(v||undefined) as PublisherMediaKind|undefined,page:1})}>{t}<small>（{n}）</small></button>)}</div>
   <div className="y-selection"><label><input type="checkbox" id="x-page-select" aria-label="本页全选" checked={rows.length>0&&rows.every(m=>selected.has(m.id))} disabled={!rows.length||selectionBusy} onChange={e=>{const map=new Map(selected);for(const m of rows){if(e.target.checked){if(map.size<20&&!mediaSelectionBlocker(m,articleHasImages))map.set(m.id,m);}else map.delete(m.id);}setBoundDraft(undefined);void persistMediaIds([...map.keys()],map);}}/>本页全选<span style={{color:'#d3c6cf',margin:'0 4px'}}>|</span><strong id="b-selection-count">已选 {selected.size} 家</strong></label><div className="actions"><button className="link" onClick={()=>favorite('')}>批量收藏</button><button className="link" onClick={()=>exportRows(selectedValues)}>导出已选</button><button className="link" onClick={()=>setDialogMessage('clear')}>清空已选</button><button className="link" onClick={()=>setCompact(!compact)}>{compact?'展开信息':'精简信息'}</button></div></div>
   <div className="y-horizontal-scroll"><RowHead/><div id="b-third-table" className="y-media-list">{rows.map(media=><MarketRow key={media.id} media={media} rules={ruleData.rules[media.id]} checked={selected.has(media.id)} onToggle={()=>toggle(media)} disabled={selectionBusy||Boolean(draftId&&!draft)||(!selected.has(media.id)&&(!!mediaSelectionBlocker(media,articleHasImages)||selected.size>=20))} onFavorite={()=>favorite(media.id)} onQuote={()=>{setQuoteError('');setQuoteMedia(media);}} onDetails={()=>setDetailMedia(media)}/>)}{!rows.length&&<div className="x-empty"><strong>{mediaQuery.loading||ruleData.loading?'正在读取媒体目录':mediaQuery.error||ruleData.error?'媒体资料暂不可用':'没有匹配的媒体'}</strong><p>{mediaQuery.error?.message||ruleData.error||'调整平台、关键词或其他条件后再试。已选媒体保持不变。'}</p><button className="button secondary x-small-button" onClick={()=>{reset();mediaQuery.reload();}}>显示全部媒体</button></div>}</div></div>
   <div id="b-third-pages" className="y-pages"><span>共 {total} 家 · 第 {filters.page} / {pageCount} 页　<select aria-label="每页媒体数" value={filters.pageSize} onChange={e=>updateFilter('pageSize',Number(e.target.value))}>{[10,20,50].map(n=><option key={n} value={n}>{n} 家 / 页</option>)}</select></span><div className="y-page-buttons"><button aria-label="上一页" disabled={filters.page<=1} onClick={()=>updateFilter('page',filters.page-1)}>‹</button>{Array.from({length:pageCount},(_,i)=>i+1).filter(n=>pageCount<=8||n===1||n===pageCount||Math.abs(n-filters.page)<2).map(n=><button className={n===filters.page?'active':''} aria-label={'第 '+n+' 页'} aria-current={n===filters.page?'page':undefined} key={n} onClick={()=>updateFilter('page',n)}>{n}</button>)}<button aria-label="下一页" disabled={filters.page>=pageCount} onClick={()=>updateFilter('page',filters.page+1)}>›</button></div></div>
   <p className="y-list-footnote">媒体资源来自供应商目录。同名不同平台分别保留；报价与发布要求以发布前核验结果为准。</p>{footer}
  </div>}
  <MediaDialog open={dataInfoOpen} title="导入数据说明" description="媒体资料来自供应商目录；未提供的字段保留为未知。" confirmLabel="知道了" footer={<><button className="button secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({catalog:mediaQuery.data,rules:ruleData.rules},null,2)],{type:'application/json;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='FrontMind-原始抓取与备注.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}>导出原始记录</button><button className="button primary" onClick={()=>setDataInfoOpen(false)}>知道了</button></>} onCancel={()=>setDataInfoOpen(false)} onConfirm={()=>setDataInfoOpen(false)}><div className="y-info-metrics"><div><strong>{total}</strong><span>匹配媒体记录</span></div><div><strong>{sourceRows.length}</strong><span>当前页记录</span></div><div><strong>{sourceRows.filter(m=>!!ruleData.rules[m.id]?.rawRemark).length}</strong><span>当前页有备注</span></div><div><strong>{selected.size}</strong><span>已选媒体</span></div></div><p>{ruleData.error||'原始备注和解析规则按媒体 ID 关联；未知要求需人工核验。'}</p></MediaDialog>
  <MediaDialog description="" open={batchOpen} title="批量搜索媒体" confirmLabel="查找匹配" footer={<><button className="button secondary" onClick={()=>setBatchOpen(false)}>关闭</button><button className="button primary" onClick={()=>{updateFilter('batchQuery',batchQueryDraft);setBatchOpen(false);}}>查找匹配</button></>} onCancel={()=>setBatchOpen(false)} onConfirm={()=>{updateFilter('batchQuery',batchQueryDraft);setBatchOpen(false);}}><p className="small muted">每行或逗号分隔名称 / 平台 / 资源 ID，多义结果需逐条选择。</p><textarea id="b-batch-input" value={batchQueryDraft} onChange={e=>setBatchQueryDraft(e.target.value)} placeholder={"media-a\n行业观察"}/><div id="b-batch-results" style={{marginTop:15}}/></MediaDialog>
  <MediaDialog description="" open={!!(dialogMessage||selectionError||marketNotice)} title={dialogMessage==='clear'?(view==='cart'?'清空第三方购物车':'清空已选媒体'):'操作提示'} confirmLabel={dialogMessage==='clear'?'确认清空':'关闭'} onCancel={()=>{setDialogMessage('');setSelectionError('');setMarketNotice('');}} onConfirm={()=>{if(dialogMessage==='clear')clearSelection();setDialogMessage('');setSelectionError('');setMarketNotice('');}}><p className={dialogMessage==='clear'?'reading':undefined}>{dialogMessage==='clear'?(view==='cart'?'移除当前任务所有第三方媒体。稿件、自有账号清单和已保存模板保留。':'将移除当前清单的全部媒体；稿件、已填写标题和已保存方案不受影响。'):dialogMessage||selectionError||marketNotice}</p></MediaDialog>
  <MediaDialog open={previewOpen} title="稿件预览" confirmLabel="返回" footer={<button className="button primary" onClick={()=>setPreviewOpen(false)}>返回</button>} onCancel={()=>setPreviewOpen(false)} onConfirm={()=>setPreviewOpen(false)}><div className="actions" style={{justifyContent:'center',marginBottom:16}}><button className="button secondary" onClick={()=>setMobilePreview(false)}>桌面</button><button className="button secondary" onClick={()=>setMobilePreview(true)}>手机</button></div><article id="preview-paper" className={'article-preview'+(mobilePreview?' mobile':'')}><h1>{task?.articleTitle||'未命名稿件'}</h1><div className="reading"><p className="block-error" role="alert">已确认 v{task?.articleVersion}。当前接口未返回此版本的完整正文，请返回编辑查看稿件。</p></div></article></MediaDialog>
  <MediaDialog open={templateOpen} title="保存组合模板" confirmLabel="保存模板" onCancel={()=>setTemplateOpen(false)} onConfirm={()=>setTemplateError('组合模板接口尚未配置，未保存本次组合。')}><label className="label" htmlFor="b-template-name">模板名称</label><input id="b-template-name" className="field" placeholder="例如：科技选型组合" value={templateName} onChange={e=>setTemplateName(e.target.value)}/>{templateError&&<p className="block-error" role="alert">{templateError}</p>}</MediaDialog>
  <MediaDialog open={!!quoteMedia} title={'录入已确认报价 · '+(quoteMedia?.name??'')} confirmLabel="保存已确认报价" onCancel={()=>setQuoteMedia(undefined)} onConfirm={()=>setQuoteError('报价写入接口尚未配置，未保存本次报价。')}><div className="notice">请填写已向供应商确认的单篇报价；保存前需要供应商报价写入接口。</div><label className="label" style={{marginTop:20}} htmlFor="y-quote-price">单篇价格（元） *</label><input className="field" type="number" id="y-quote-price" min="0" step="0.01" placeholder="请输入已确认价格" value={quotePrice} onChange={e=>setQuotePrice(e.target.value)}/><label className="label" style={{marginTop:14}} htmlFor="y-quote-source">报价来源 / 供应商 *</label><input className="field" id="y-quote-source" placeholder="例如：供应商名称与确认记录" value={quoteSource} onChange={e=>setQuoteSource(e.target.value)}/><label className="ack"><input type="checkbox" id="y-quote-ack" checked={quoteAck} onChange={e=>setQuoteAck(e.target.checked)}/><span>我已核对报价与可投状态。人工录入不代表系统核验或锁定供应商价格。</span></label><p id="y-quote-error" className="block-error" role="alert">{quoteError}</p></MediaDialog>
  <MediaDetails checked={!!detailMedia&&selected.has(detailMedia.id)} onToggle={()=>{if(detailMedia)toggle(detailMedia);}} onQuote={()=>setQuoteMedia(detailMedia)} media={detailMedia} rules={detailMedia?ruleData.rules[detailMedia.id]:undefined} onClose={()=>setDetailMedia(undefined)}/>
  <MediaDialog open={articleChooserOpen} title="绑定已确认稿件" confirmLabel="绑定并继续" busy={selectionBusy} onCancel={()=>setArticleChooserOpen(false)} onConfirm={()=>void bindArticle()} footer={<><Link className="button secondary" href={projectWorkspaceUrl('/publishing/articles')} onClick={()=>setArticleChooserOpen(false)}>查看稿件</Link><button className="button primary" disabled={selectionBusy} onClick={()=>void bindArticle()}>绑定并继续</button></>}><p className="small muted">选择已有的已确认任务，或返回编辑页确认稿件。研究清单将按资源去重复制到该任务，不覆盖任务原有选择。</p><select id="b-bind" value={chosenVersion} onChange={e=>setChosenVersion(e.target.value)}>{frozenArticles.map(article=><option key={article.currentVersionId} value={article.currentVersionId}>{article.title}</option>)}</select>{(articlesQuery.loading||articlesQuery.error||selectionError||!frozenArticles.length)&&<p className="block-error" role="alert">{selectionError||articlesQuery.error?.message||(articlesQuery.loading?'正在加载稿件…':'请先在稿件页面确认一份稿件')}</p>}</MediaDialog>
    </MediaShell>;
}
function facetCount(
  options: Array<{ value: string; count: number }> | undefined,
  value: string,
) {
  if (!options) return undefined;
  return options.find((option) => option.value === value)?.count ?? 0;
}

