# 媒体服务 API 开发指南

这里是子域名发布 worker 使用的完整服务端客户端实现，开发者可以直接修改。
主仓 `@frontmind/monitoring-provider-kol` 兼容包转发到这里，保留一份业务实现。
公开仓不带运行凭据；开发团队在子域名使用服务器已有配置验收，无需获取 key。

## 调用流程与文件

```text
页面 → server/routes.ts → 稿件/报价/订单持久化
                        → worker任务 → 本目录KolClient → 保存结果 → 页面展示
```

| 文件 | 职责 |
|---|---|
| `client.ts` | HTTP 请求、目录与订单 API、安全 GET 重试、订单不重复发送 |
| `token.ts` | 账号鉴权 token 缓存与刷新协作 |
| `schemas.ts` | 外部响应结构校验 |
| `normalize.ts` | 媒体、价格、标签、logo与订单状态归一化 |
| `types.ts` | 客户端输入输出、配置和接口类型 |
| `errors.ts` | 配置、鉴权、限流、无效响应、提交结果不确定等错误 |
| `mock.ts` | 离线模拟实现，不能作为真实 API 验收证明 |
| `runtime.ts` | 服务端读取现有环境配置、创建客户端与只读连接检查 |
| `unavailable.ts` | 未配置供应商时的禁用实现；所有操作报未配置，不发起网络请求 |

`worker/processor.ts` 拥有目录全量同步、执行和恢复决策；
`server/publisher-worker-repository.ts` 拥有事务、状态和资金处理。
页面工作概览读取本地已同步目录，不会在每次打开页面时重新下载整个媒体库。

## 当前已实现 API

这里的“完整”指当前系统已接入的客户端源码；不宣称覆盖供应商所有其他产品。

| 方法 | 外部端点 | 行为 |
|---|---|---|
| 内部 `authenticate` | `POST /api/auth/authenticate` | 账号方式获取 token |
| `listResources(page, signal)` | `GET /api/news_resource_2/data` | 获取指定页，保留分页证据与价格/媒体字段 |
| `listOrders(query, signal)` | `GET /api/news_order` | 按页、记录 id 或订单号查询 |
| `getOrderByOrderId(id, signal)` | 同上 | 精确匹配已接受订单号 |
| `createOrder(input, signal)` | `POST /api/news_order` | 发送媒体 id、标题、HTML，返回可核对订单号 |

客户端从服务器运行入口注入 `baseUrl` 和 `accessToken`，也支持完整账号配置。
默认先使用已有 token；安全 GET 遇到 401 且完整账号配置存在时才刷新一次。
不要将这些配置放进 `VITE_*`、网页请求体或 Pro 修改包。

目录与订单 GET 遇到临时网络、HTTP 或非 JSON 响应时有有限次数退避重试。
订单 POST 是可能收费的非幂等操作：提交后连接中断或返回不明确时记录
`submission_unknown`，不得通过自动重试或切换编码再次下单。订单查询用于核实
既有结果。真实发送开关与 test 模式指定媒体限制仍由服务器配置决定。

## 无 key 的团队开发步骤

1. delivery Skill 导出准确线上源码基线。
2. 修改本目录、关联业务状态或契约，并添加 fake-fetch 测试。
3. 在公开子仓根目录运行 `pnpm typecheck && pnpm test && pnpm build`。
4. delivery Skill 提交并发布 `publish.frontmind.cn`，确认 API/worker 的实际版本。
5. 在子域名验证目录、筛选、报价、草稿和结果。外发按负责人指定稿件、媒体和
   额度进行，普通代码检查、构建和发布不会自动下单。
6. 记录操作、时间、结果和 moduleSha/coreSha，验收后再同步回主仓。

离线 provider 测试：`pnpm --dir module exec vitest run server/providers/kol`。
在主仓路径下则使用 `pnpm --dir modules/publish exec vitest run server/providers/kol`。
测试使用合成 `.test` 端点和 fake fetch，不连接真实服务，不需要任何凭据。

## 增加新的 API 功能

成员可以新增功能，不限于修改上述已有方法：

1. 在 `types.ts` 定义新方法输入输出，在 `schemas.ts` 增加响应校验。
   为 `KolProviderPort` 新增方法时，同步实现 `KolClient`、`MockKolClient` 和
   `unavailablePublishingProvider`；这三个实现均在本子仓，不需要改私有 worker。
2. 在 `client.ts` 实现供应商新端点，在 `normalize.ts` 整理业务字段；复用鉴权、
   超时与 GET 重试。新增 POST 必须按接口幂等语义处理，不能照搬 GET 重试。
3. 在 `server/routes.ts` 的 `publisher.provider` 下增加带输入/输出校验的业务
   procedure，沿用 `publisherCustomerProcedure`。通过 `createKolRuntimeClient()`
   使用服务器已有 `PUBLISHER_KOL_*` 配置及支持的 `KOL_*` 兼容字段，无需在私有
   Core 新建一份客户端实现。该 namespace 不是任意 URL 代理，不能接收 key 或
   允许用户覆盖服务端地址、owner、管理员身份。
4. 涉及长任务、订单或数据保存时，在 `worker/ports.ts`、任务处理器、业务
   repository 和必要 schema 中补齐处理；新计费写操作继续走既有资金/幂等事务，
   不直接从页面或简易路由绕过订单系统发稿。
5. 在 `client/` 中添加对应展示或操作，编写 fake-fetch/业务契约测试，再按同一
   ZIP 流程发布到子域名。新增供应商权限、全新凭据种类或数据库迁移需同步说明。

已有扩展示例：

- `publisher.provider.status`：仅返回是否配置、模式和发送开关；不证明真实连接。
- `publisher.provider.checkConnection`：服务端真实 GET 媒体第一页，只返回成功标志、
  数量与分页，不返回 token、媒体原始数据，也不创建订单。

对应 tRPC 根地址为 `/api/monitoring/trpc`，均沿用开发门禁、固定工作区及服务端
授权。主仓继续注入真实账号/项目上下文，模块无需重新实现登录和租户。
