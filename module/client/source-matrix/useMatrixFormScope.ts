import { useEffect, useMemo, useRef, useState } from 'react';
import { matrixApi } from './api';

/** Never use route/user-provided IDs as a private browser-storage boundary. */
export function useMatrixFormScope(gateway: object, workspace: number, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  // A new enable cycle must reauthenticate before exposing any prior key,
  // including research -> article -> research within the same mounted page.
  const requestScope = useMemo(() => ({ gateway, workspace, enabled, attempt }), [gateway, workspace, enabled, attempt]);
  const [state, setState] = useState<{ requestScope: typeof requestScope; scopeKey?: string; error?: string }>();
  const active = useRef(requestScope);
  active.current = requestScope;
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && active.current === requestScope;
    void matrixApi<{ scopeKey?: unknown }>('/matrix/form-scope', abort.signal).then(value => {
      if (!current()) return;
      if (typeof value.scopeKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.scopeKey)) throw new Error('invalid_form_scope');
      setState({ requestScope, scopeKey: value.scopeKey });
    }).catch(() => {
      if (current()) setState({ requestScope, error: '暂时无法保存本次草稿，已填写内容仍保留在当前页面。' });
    });
    return () => abort.abort();
  }, [requestScope]);
  const current = enabled && state?.requestScope === requestScope ? state : undefined;
  return { scopeKey: current?.scopeKey, error: current?.error, retry: () => setAttempt(value => value + 1) };
}
