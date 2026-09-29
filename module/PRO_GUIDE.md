# Pro 交接指南：媒体发布

从 `frontmind-module-delivery` 提供的实际线上完整 commit SHA 开始修改。
仓库：<https://github.com/xiafanzeng/frontmind-publish>；目标子域名：
<https://publish.frontmind.cn/>。

## 修改位置

- 页面、业务 API、持久化、worker 与供应商客户端均在 `module/`。
- 供应商客户端是 `module/server/providers/kol/`，含完整真实实现与 fake-fetch
  测试。团队可修改分页、数据映射、请求格式和异常处理，不必修改私有 Core。
- 本地只运行预览与假数据测试；使用服务器已有配置在子域名验收真实 API。
- 不包含或修改 key、运行配置、部署目标、客户数据、`vendor/` 或私有 Core。
- 不擅自移除资金/幂等/订单状态校验，也不为失败订单自动重发 POST。
- 前端不要导入服务端 provider，不需要实现登录、租户或通用智能体。

## 交付

返回 `handoff.json`、`HANDOFF.md` 和 `files/` 中的完整修改文件。依赖变化放在
`module/package.json`，同时提交对应锁文件；删除显式写进 `handoff.json`。
保留准确的 `baseCommit`，不存在于 ZIP 的文件不代表删除。

执行 `pnpm typecheck`、`pnpm test`、`pnpm build`，写清实际通过与未执行的检查。
说明 API/worker 受影响范围、预期行为和子域名验收步骤。提交和部署不自动创建
真实媒体订单；需要验证外发时，按明确指定的稿件、媒体与额度执行。
