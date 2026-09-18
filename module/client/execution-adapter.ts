import {projectBusinessExecution,type PublicBusinessEvidence} from "@frontmind/module-contracts/execution";
import type {PublicationBatch} from "./types";
const stamp = (value?: string | null) => value ? Date.parse(value) : Number.NaN;
export function publishingPublicExecution(batch: PublicationBatch) {
  const entries: PublicBusinessEvidence[] = [{ id: `${batch.id}:created`, turnId: batch.id, timestamp: stamp(batch.createdAt), rank: 0, phase: "creating_publication", status: "ended" }];
  for (const [index, item] of batch.items.entries()) {
    const subject = item.media?.name;
    const rank = 1 + index * 100;
    for (const attempt of item.submissionAttempts ?? []) {
      entries.push({ id: `${batch.id}:${item.id}:attempt:${attempt.id}`, turnId: batch.id, timestamp: stamp(attempt.startedAt), rank: rank + attempt.number, phase: "submitting_publication", subject,
        status: attempt.result === "succeeded" ? "ended" : attempt.result === "submission_unknown" ? "waiting" : attempt.result ? "error" : "running",
        ...(attempt.completedAt ? { finishedAt: stamp(attempt.completedAt) } : {}) });
    }
    if (item.submittedAt) entries.push({ id: `${batch.id}:${item.id}:accepted`, turnId: batch.id, timestamp: stamp(item.submittedAt), rank: rank + 90, phase: "accepted_publication", subject, status: "ended" });
    // Unknown outcomes and local failures are current recorded states, never proof of acceptance.
    if (item.updatedAt) entries.push({ id: `${batch.id}:${item.id}:result`, turnId: batch.id, timestamp: stamp(item.completedAt ?? item.updatedAt), rank: rank + 91,
      phase: ["queued", "submitting", "processing", "submission_unknown"].includes(item.status) ? "awaiting_publication" : "showing_publication", subject,
      status: ["failed", "auth_blocked"].includes(item.status) || batch.status === "failed" ? "error" : item.status === "success" ? "ended" : "waiting" });
  }
  return projectBusinessExecution(batch.id, entries);
}
