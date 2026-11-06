import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatPublishingMoney } from "../types";

/** Shared primitives for the index3 reference pages ("白底操作台"). */

const ICON_PATHS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 12h8M8 16h6"/>',
  media: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  matrix: '<circle cx="12" cy="4" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="m11 6-6 11m8-11 6 11M6 19h12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="m12 3 10 18H2Z"/><path d="M12 8v5m0 3h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  folder: '<path d="M3 5h6l2 3h10l-2 12H3Z"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M3 15v6h18v-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  sort: '<path d="M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M3 17v4h18v-4"/>',
};

export function Icon({ name, className = "icon" }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? ICON_PATHS.file! }} />
  );
}

export const money = formatPublishingMoney;

export function Badge({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Btn({
  variant = "",
  icon,
  children,
  ...rest
}: { variant?: string; icon?: string; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn ${variant}`.trim()} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <div className="search-box">
      <Icon name="search" />
      <input
        id={id}
        type="search"
        className="control"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="clear-search visible" aria-label="清空搜索" onClick={() => onChange("")}>
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}

export function PageHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

/* ---------- Toast ---------- */

type ToastListener = (text: string) => void;
const toastListeners = new Set<ToastListener>();

export function toast(text: string) {
  toastListeners.forEach((listener) => listener(text));
}

export function ToastHost() {
  const [text, setText] = useState("");
  const timer = useRef<number>(0);
  useEffect(() => {
    const listener: ToastListener = (next) => {
      window.clearTimeout(timer.current);
      setText(next);
      timer.current = window.setTimeout(() => setText(""), 3800);
    };
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
      window.clearTimeout(timer.current);
    };
  }, []);
  if (!text) return null;
  return (
    <div className="toast visible" role="status" aria-live="polite" aria-atomic="true">
      <Icon name="check" />
      <span>{text}</span>
    </div>
  );
}

/* ---------- Dialog ---------- */

type DialogSpec = { title: string; body: ReactNode; footer?: ReactNode; onOpen?: () => void };

const DialogContext = createContext<{ open: (spec: DialogSpec) => void; close: () => void }>({
  open: () => undefined,
  close: () => undefined,
});

export function useIndex3Dialog() {
  return useContext(DialogContext);
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCallback((next: DialogSpec) => setSpec(next), []);
  const close = useCallback(() => setSpec(null), []);
  const value = useMemo(() => ({ open, close }), [open, close]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (spec) {
      if (!dialog.open) dialog.showModal();
      spec.onOpen?.();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [spec]);
  return (
    <DialogContext.Provider value={value}>
      {children}
      <dialog ref={ref} aria-labelledby="fm3-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
        <div className="dialog-header">
          <h2 id="fm3-dialog-title">{spec?.title}</h2>
          <Btn variant="subtle icon-only" aria-label="关闭弹窗" onClick={close}><Icon name="close" /></Btn>
        </div>
        <div className="dialog-body">{spec?.body}</div>
        <div className="dialog-footer">{spec?.footer ?? <Btn onClick={close}>关闭</Btn>}</div>
      </dialog>
    </DialogContext.Provider>
  );
}

/* ---------- Workflow position indicator ---------- */

export const WORKFLOW_STEP_LABELS = ["编辑稿件", "选择媒体", "配置标题"] as const;

/**
 * 三步流程条。V5：当前步骤之前的阶段可点击回退（与页面内的独立返回按钮等价），
 * 当前与未来步骤不可点。onStepSelect 缺省时整条保持纯展示。
 */
export function WorkflowPosition({ step, detail, onStepSelect }: {
  step: number;
  detail?: string;
  /** 点击已完成步骤时的回退回调（仅 index < step 会触发）。 */
  onStepSelect?: (index: number) => void;
}) {
  const labels = WORKFLOW_STEP_LABELS;
  return (
    <nav className="workflow-position" aria-label="当前发布步骤">
      <span className="workflow-caption">当前步骤</span>
      <ol>
        {labels.map((label, index) => {
          const earlier = index < step && Boolean(onStepSelect);
          return (
            <li
              key={label}
              className={[
                index === step ? "current" : index < step ? "complete" : "",
                earlier ? "earlier" : "",
              ].filter(Boolean).join(" ") || undefined}
              {...(index === step ? { "aria-current": "step" as const } : {})}
            >
              {earlier ? (
                <button type="button" className="workflow-back" onClick={() => onStepSelect?.(index)}>
                  <span className="workflow-number" aria-hidden="true">✓</span>
                  <span>{label}</span>
                </button>
              ) : (
                <>
                  <span className="workflow-number" aria-hidden="true">{index < step ? "✓" : index + 1}</span>
                  <span>{label}</span>
                </>
              )}
              {index < 2 ? <span className="workflow-arrow" aria-hidden="true">→</span> : null}
            </li>
          );
        })}
      </ol>
      {detail ? <span className="workflow-detail">{detail}</span> : null}
    </nav>
  );
}

/**
 * 工作台“待继续的稿件”行内迷你步骤条：0=编辑稿件、1=选择媒体、2=配置标题。
 * 只标识当前推进位置；进入流程由行内按钮完成，迷你条本身不交互。
 */
export function MiniFlowSteps({ step, failed }: { step: 0 | 1 | 2; failed?: boolean }) {
  return (
    <span className={`mini-steps${failed ? " is-failed" : ""}`} aria-label={failed ? `当前步骤：${WORKFLOW_STEP_LABELS[step]}，发布失败` : `当前步骤：${WORKFLOW_STEP_LABELS[step]}`}>
      {WORKFLOW_STEP_LABELS.map((label, index) => (
        <span key={label} className={`mini-step ${index === step ? "current" : index < step ? "done" : ""}`.trim() || undefined}>
          <b aria-hidden="true">{index < step ? "✓" : index + 1}</b>
          {label}
        </span>
      ))}
    </span>
  );
}
