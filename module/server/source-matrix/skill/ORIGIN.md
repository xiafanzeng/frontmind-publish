# 来源与版本

上游：用户提供的 source-matrix-planner-excel-ranked-20261026.zip。
上游 ZIP SHA-256：495d2ddd6d995f09c9bc514aeb3128dbcc1a6960c39ae789065e9f432f761b9f。

版本：2026.10.26-web.1。从该包完整 Skill 目录复制后，补充独立内容篇数/报价规划契约、确定性校验入口、结构化矩阵介绍与层内排序校验、测试源码和可重打包清单。

网站入口为 module/server/source-matrix/http.ts，运行原生 TypeScript，不启动 Python 子进程。独立交付包的 website-runtime/ 是从项目实际修改源码逐字节收集的快照，散列见交付清单；它不是另行手写的模拟实现。Python scripts/planner.py、export_adapter.py 继续服务离线使用；scripts/content_planning.py 为新独立校验入口。

demo/skill-original、demo/outputs 和旧一航保存结果属于历史归档，未改写为本版结果。上游例子、虚构报价和旧测试报告均不构成本版真实运行证明。

本轮未执行运行验证，交由智谱 ZCode 和网站验收。
