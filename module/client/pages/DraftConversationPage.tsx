import { useLocation, useSearch } from "wouter";
import { publishingTaskUrl, usePublishingFlow } from "../PublishingFlowContext";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import {
  WorkflowCompleted,
  WorkflowSection,
} from "../host";
import { requestWorkspaceNavigation } from "../host";
import TitlesPage from "./TitlesPage";
import ReviewPage from "./ReviewPage";

export default function DraftConversationPage({
  draftId,
  initialStage,
}: {
  draftId: string;
  initialStage: "titles" | "review";
}) {
  const flow = usePublishingFlow();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { draftIds, excludedDraftIds } = readPublishingBatch(draftId, search);
  const stagePath = (stage: "titles" | "review") => publishingTaskUrl(
    withPublishingBatch(
      `/publishing/drafts/${encodeURIComponent(draftId)}/${stage}${search ? `?${search}` : ""}`,
      draftIds,
      excludedDraftIds,
    ),
    flow?.taskId,
  );
  // The URL owns the stage; stale presentation choices cannot override Back or deep links.
  const revise = (path: string) => requestWorkspaceNavigation(() => navigate(path));
  const saved = (reviewPath?: string) => navigate(reviewPath ?? stagePath("review"));
  if (!flow)
    return initialStage === "titles" ? (
      <TitlesPage draftId={draftId} onSaved={saved} />
    ) : (
      <ReviewPage draftId={draftId} onRevise={revise} />
    );
  return (
    <div className="publishing-page publishing-flow-step" data-publishing-stage={initialStage}>
      {initialStage === "titles" ? (
        <>
        <WorkflowCompleted
          id="publishing-input"
          summary="稿件与媒体已准备好，可继续配置本次投放"
        />
        <WorkflowSection id="publishing-titles" title="配置发布标题">
          <TitlesPage draftId={draftId} onSaved={saved} />
        </WorkflowSection>
        </>
      ) : (
          <ReviewPage
            draftId={draftId}
            onRevise={revise}
            onSubmitted={(id) => {
              navigate(publishingTaskUrl(
                `/publishing/publications/${encodeURIComponent(id)}?submitted=1`,
                flow.taskId,
              ));
            }}
          />
      )}
    </div>
  );
}
