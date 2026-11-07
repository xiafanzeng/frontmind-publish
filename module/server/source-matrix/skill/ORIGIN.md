# 来源与版本

上游：用户提供的 source-matrix-planner-excel-ranked-20261026.zip。
上游 ZIP SHA-256：495d2ddd6d995f09c9bc514aeb3128dbcc1a6960c39ae789065e9f432f761b9f。

版本：2026.11.07-web.2。在仓库2026.10.26-web.1基础上，保留独立内容篇数/报价规划契约、确定性校验入口、结构化矩阵介绍与层内排序；本轮同步网站运行指令、平台唯一适配器、冻结正文与真实行业分布快照规则。离线Python及历史产物不改写为本轮运行结果。

本轮参考附件source-matrix-planner-20261026.zip的SHA-256为69df6cfdad43266b6660654c87cf0a16fb5474d52d351c4efabe8d660d68619c。只读比较其中47个skill条目：去CR并去尾部空白后的文本仅assets/preview.css内容不同；逐字节比较另有换行/尾部空白差异，不宣称仓库逐字节仅一项不同。未执行附件脚本，未复制其虚构媒体、报价或旧运行状态作为真实数据。

网站入口为 module/server/source-matrix/http.ts，运行原生 TypeScript，不启动 Python 子进程。独立交付包的 website-runtime/ 是从项目实际修改源码逐字节收集的快照，散列见交付清单；它不是另行手写的模拟实现。Python scripts/planner.py、export_adapter.py 继续服务离线使用；scripts/content_planning.py 为新独立校验入口。

demo/skill-original、demo/outputs 和旧一航保存结果属于历史归档，未改写为本版结果。上游例子、虚构报价和旧测试报告均不构成本版真实运行证明。

本轮未执行运行验证，交由智谱 ZCode 和网站验收。
