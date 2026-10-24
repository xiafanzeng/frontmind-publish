import { useRef, useState } from 'react';
import type { PublishingFlow } from './PublishingFlowContext';

/** Keep one selection scope while ensureTask assigns its first task ID. Only
 * the ID actually returned by that call may be adopted. Later task switches,
 * or a changed workspace/version/route binding, still invalidate the operation.
 * `context` must be memoized by the caller from its business binding.
 * The scope key derives from the business task ID frozen when the owner is
 * created, never from a mount-local React id: draft-query cache keys and the
 * research-shortlist storage key built on it must stay stable when the same
 * binding remounts, while a first-ID assignment inside this scope keeps it. */
export function useMediaSelectionTask(flow: PublishingFlow | null, context: object) {
  const serial = useRef(0);
  const [, invalidate] = useState(0);
  const owner = useRef({ context, id: flow?.taskId, keyId: flow?.taskId, creating: false, allowedId: undefined as string | undefined, serial: 0 });
  const taskId = flow?.taskId;
  if (owner.current.context !== context || owner.current.id !== taskId) {
    const pendingAssignment = owner.current.context === context && !owner.current.id && taskId &&
      (owner.current.creating || owner.current.allowedId === taskId);
    if (pendingAssignment) owner.current.id = taskId;
    else owner.current = { context, id: taskId, keyId: taskId, creating: false, allowedId: undefined, serial: ++serial.current };
  }
  const current = owner.current;
  return {
    scopeKey: `${current.keyId ?? 'new'}:${current.serial}`,
    async ensureTask() {
      if (!flow) return undefined;
      current.creating = !current.id;
      try {
        const id = await flow.ensureTask();
        if (owner.current !== current)
          throw new Error('选媒任务已切换，请在当前任务重新选择。');
        if (current.id && current.id !== id) {
          // A provisional assignment turned out to be another task. Invalidate
          // its optimistic state before the caller's failure path can retain it.
          owner.current = { ...current, creating: false, allowedId: undefined, serial: ++serial.current };
          invalidate(value => value + 1);
          throw new Error('选媒任务已切换，请在当前任务重新选择。');
        }
        current.allowedId = id;
        return id;
      } finally {
        current.creating = false;
      }
    },
  };
}
