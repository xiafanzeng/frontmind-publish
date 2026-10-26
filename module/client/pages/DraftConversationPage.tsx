import TitlesPage from "./TitlesPage";

export default function DraftConversationPage({
  draftId,
}: {
  draftId: string;
  /** Old embedded hosts may still request review; retain their complete URL context. */
  initialStage: "titles" | "review";
}) {
  // Embedded hosts may keep their historical review stage. Both stages now
  // render the same page; canonical URL replacement belongs to PublishingRoutes.
  return <TitlesPage draftId={draftId} />;
}
