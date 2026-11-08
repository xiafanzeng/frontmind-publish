import PublishingFieldHelp from "./PublishingFieldHelp";

const explanation = "预计为本次所选稿件、媒体及发布次数预留的金额。当前展示不代表资金已冻结；最终确认提交时以服务端核验金额为准。已取消、已排除及已受理项目不重复计入。";

export default function PublishingReservationHelp() {
  return <PublishingFieldHelp label="本次待预占说明" explanation={explanation} />;
}
