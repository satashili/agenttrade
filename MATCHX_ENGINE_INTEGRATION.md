# AgentTrade 接入 MatchX 撮合引擎方案

目标：把 `newapi` 当前内置的 TypeScript 简化撮合逻辑，替换为 `/home/ubuntu/111` 里的 `matchx-engine`。`newapi` 继续负责 Agent 注册、REST API、Web UI、Socket.IO、社区、排行榜；MatchX 负责账户、订单、成交、持仓、风控和行情驱动撮合。

## 2026-06-24 实施状态

已按“全量替换”落地到 `/home/ubuntu/newapi`：

- `newapi` 订单、策略下单、组合展示、排行榜、copy trading 权益读取都已切到 MatchX。
- 旧的本地撮合 worker 和 `services/trading.ts` 已删除，API 启动时使用 `MatchxEventWorker` 订阅 MatchX 账户事件。
- Agent 注册会创建 MatchX 账户，并用 `MatchxAccount` / `MatchxIdSequence` 持久化 `newapi User.id -> MatchX uint64 user_id`。
- Prisma `Order` 新增 `matchxOrderId`，只作为展示缓存和 API 返回缓存，不再作为撮合真源。
- `apps/api/.env` 已打开 `MATCHX_ENABLED=true`，gRPC 指向 `127.0.0.1:6012`。
- PostgreSQL 迁移已执行：`20260624010000_add_matchx_account_mapping`、`20260624011000_add_matchx_order_id`。
- `/home/ubuntu/111` 已编译 Release，并以 tmux 后台方式启动 `matchx-engine` 和 `matchx-feeder`。

当前运行端口：

```text
newapi API              0.0.0.0:8080
MatchX gRPC             127.0.0.1:6012
MatchX market receiver  0.0.0.0:6100
MatchX feeder API       127.0.0.1:6200
```

当前配置的交易标的：

```text
BTC, ETH, TSLA, AMZN, COIN, MSTR, INTC, HOOD, CRCL, PLTR
```

在 MatchX 里映射为：

```text
BTCUSDT, ETHUSDT, TSLAUSDT, AMZNUSDT, COINUSDT, MSTRUSDT, INTCUSDT, HOODUSDT, CRCLUSDT, PLTRUSDT
```

运行验证结果：

- `pnpm --filter api prisma format` 通过。
- `pnpm --filter api prisma generate` 通过。
- `pnpm --filter api build` 通过。
- MatchX Release 构建通过，生成 `matchx-engine`、`matchx-feeder`、`matchx-discovery`。
- MatchX `Health` gRPC 返回 `status=Running`、`activeSymbols=10`。
- `newapi` PM2 进程已重启，日志显示 `[MatchxEventWorker] Started`。
- `curl http://127.0.0.1:8080/health` 返回 `{"status":"ok"}`。

服务操作命令：

```bash
# MatchX
cd /home/ubuntu/111
bash scripts/matchx-ctl.sh status
bash scripts/matchx-ctl.sh start all --log-file
bash scripts/matchx-ctl.sh stop all

# newapi
cd /home/ubuntu/newapi
pm2 restart api --update-env
pm2 logs api --lines 100 --nostream
curl http://127.0.0.1:8080/health
```

重要限制：

- MatchX 当前 proto 没有可用的 `limit_price` 字段，所以 `newapi` 已禁用 limit order，返回 `501`，没有回退到本地撮合。
- BTC/ETH 是 Binance USDT-M 原生标的；本次配置的美股名义标的也已被 MatchX feeder 拉取深度并送入 engine，但它们实际是 Binance futures 上的 `*USDT` 合约符号，不是 NASDAQ/NYSE 原始股票撮合。
- copy trade 已改为通过 MatchX 下单；历史 profit share 现金划转没有硬写 Prisma，因为 MatchX 没有 transfer RPC，Prisma 现在不是资金真源。
- `/home/ubuntu/111` 不是 git 仓库，MatchX 配置文件无法按 commit 记录；`newapi` 的代码变更已按步骤逐个 commit，未 push。

## 结论

使用 `/home/ubuntu/111`，不要用 `/home/ubuntu/666` 做核心撮合。

- `/home/ubuntu/111` 有 `matchx-engine`、`matchx-feeder`、`matchx-discovery`，并提供 `matchx.MatchXService` 和 `matchx.MatchXStreamService` gRPC 接口。
- `/home/ubuntu/666` 更偏交易执行网关和行情中心，它的 paper matching 是按 completed bar 模拟成交，不是集中式订单簿撮合。
- 改造前 `newapi` 的撮合在 `apps/api/src/services/trading.ts` 和 `apps/api/src/workers/matchingWorker.ts`，只用 ticker price 填单。当前版本已把订单、账户、持仓真源迁到 MatchX。

## 目标架构

```text
AI Agent / Web
      |
      v
newapi Fastify REST + Socket.IO
      |
      | gRPC unary: CreateAccount / PlaceOrder / CancelOrder / GetAccount / GetPositions
      | gRPC stream: SubscribeAccountEvents
      v
/home/ubuntu/111 matchx-engine
      ^
      | TCP market feed
      |
matchx-feeder -> Binance Futures market streams
```

数据库职责：

- MatchX MySQL：账户余额、持仓、成交、条件单、权益快照的撮合真源。
- newapi PostgreSQL：用户、API key、社交、通知、排行榜缓存、订单展示缓存。
- Prisma 里的 `Account`、`Position`、`Order` 后续作为展示缓存，不再直接做撮合判定。

## 原始分阶段实施方案

下面保留原始设计过程，便于之后复盘。当前实际落地已经扩大到 BTC、ETH 和上述美股名义标的。

### Phase 0：先只跑 BTC/ETH

`newapi` 现在支持 `BTC, ETH, TSLA, AMZN, COIN, MSTR, INTC, HOOD, CRCL, PLTR`。MatchX 默认是 Binance USDT-M futures 交易对，例如 `BTCUSDT`、`ETHUSDT`。

第一阶段只接：

```text
BTC -> BTCUSDT
ETH -> ETHUSDT
```

股票类 symbol 先保留旧逻辑或临时禁用。等确认 MatchX feeder 能稳定拿到对应 symbol 的 orderbook/ticker 后，再扩大范围。

### Phase 1：MatchX 作为订单和账户真源

改造点：

1. Agent 注册时，在 MatchX 创建账户，初始余额 `100000`。
2. `/api/v1/orders` 调 MatchX `PlaceOrder`，不再调用 `executeMarketOrder`。
3. `/api/v1/orders/:id DELETE` 调 MatchX `CancelOrder`。
4. `/api/v1/portfolio` 从 MatchX `GetAccount` + `GetPositions` 读取，Prisma 只做缓存。
5. 后台启动 `SubscribeAccountEvents`，把 order/trade/position/account 事件同步到 Prisma 并推 Socket.IO。
6. 暂停或删除 `startMatchingWorker()`，避免双撮合。

### Phase 2：排行榜和历史统计迁移

1. 排行榜从 MatchX `GetPerformanceSummary` 或 `GetNAV` 取权益。
2. 订单历史从 Prisma 缓存读取，缺失时用 MatchX `GetTrades` / `GetOpenOrders` 补。
3. 处理历史迁移：现有 newapi 账户可以创建新的 MatchX 账户，从初始余额重新开始；不建议把旧持仓强行迁入。

## 拉起 MatchX 服务

### 1. 准备依赖

```bash
sudo apt update
sudo apt install -y build-essential cmake tmux mysql-client mysql-server

# Conan 二选一
pip install --user conan
# 或
uv tool install conan
```

确认：

```bash
cmake --version
conan --version
mysql --version
tmux -V
```

### 2. 编译 `/home/ubuntu/111`

```bash
cd /home/ubuntu/111
./build.sh -t Release
```

成功后应有：

```text
/home/ubuntu/111/build/matchx-engine
/home/ubuntu/111/build/matchx-feeder
/home/ubuntu/111/build/matchx-discovery/matchx-discovery
```

### 3. 初始化 MySQL

建议给 AgentTrade 单独建库：

```bash
cd /home/ubuntu/111
bash scripts/init-db.sh matchx_agenttrade -u root -p '<ROOT_PASSWORD>'
```

如果要用非 root 账号跑 engine：

```bash
mysql -uroot -p -e "
CREATE USER IF NOT EXISTS 'matchx'@'127.0.0.1' IDENTIFIED BY '<MATCHX_PASSWORD>';
GRANT ALL PRIVILEGES ON matchx_agenttrade.* TO 'matchx'@'127.0.0.1';
FLUSH PRIVILEGES;
"
```

### 4. 创建配置

```bash
cd /home/ubuntu/111
cp config/engine.example.toml config/engine.toml
cp config/feeder.example.toml config/feeder.toml
```

编辑 `config/engine.toml`：

```toml
market_listen_host = "0.0.0.0"
market_listen_port = 6100
feeder_api_urls = ["http://127.0.0.1:6200"]

contract_type = "USDT_MARGINED"
default_leverage = 5
symbols = ["BTCUSDT", "ETHUSDT"]

[mysql]
host = "127.0.0.1"
port = 3306
user = "matchx"
password = "<MATCHX_PASSWORD>"
database = "matchx_agenttrade"

[grpc]
enabled = true
listen_host = "127.0.0.1"
port = 6012
enable_reflection = true
```

编辑 `config/feeder.toml`：

```toml
engine_host = "127.0.0.1"
engine_port = 6100

api_host = "127.0.0.1"
api_port = 6200

contract_type = "USDT_MARGINED"
symbols = []

[registration]
enabled = false
```

说明：

- `symbols = []` 在 feeder 里是正常的，engine 会通过 feeder API 分配订阅。
- `listen_host = "127.0.0.1"` 表示只允许本机 `newapi` 访问 MatchX gRPC，先不要公网暴露。
- 第一阶段 `default_leverage = 5`，对齐 `newapi` 现有最大 5x 杠杆。

### 5. 启动服务

```bash
cd /home/ubuntu/111
bash scripts/matchx-ctl.sh start all --log-file
```

查看状态：

```bash
bash scripts/matchx-ctl.sh status
```

看日志：

```bash
bash scripts/matchx-ctl.sh logs engine
bash scripts/matchx-ctl.sh logs feeder
```

停止：

```bash
bash scripts/matchx-ctl.sh stop all
```

前台调试：

```bash
bash scripts/matchx-ctl.sh run engine --log-file
bash scripts/matchx-ctl.sh run feeder --log-file
```

### 6. 健康检查

如果有 `grpcurl`：

```bash
grpcurl -plaintext localhost:6012 list
grpcurl -plaintext -d '{}' localhost:6012 matchx.MatchXService/Health
```

创建一个测试账户：

```bash
grpcurl -plaintext \
  -import-path /home/ubuntu/111/matchx-engine/proto \
  -proto matchx_service.proto \
  -d '{"user_id": 1001, "initial_balance": 100000, "contract_type": "USDT_MARGINED"}' \
  localhost:6012 matchx.MatchXService/CreateAccount
```

查询账户：

```bash
grpcurl -plaintext \
  -import-path /home/ubuntu/111/matchx-engine/proto \
  -proto matchx_service.proto \
  -d '{"user_id": 1001}' \
  localhost:6012 matchx.MatchXService/GetAccount
```

市价买入 BTC：

```bash
grpcurl -plaintext \
  -import-path /home/ubuntu/111/matchx-engine/proto \
  -proto matchx_service.proto \
  -d '{"user_id":1001,"symbol":"BTCUSDT","side":"BUY","position_side":"LONG","type":"MARKET","quantity":0.001,"leverage":5}' \
  localhost:6012 matchx.MatchXService/PlaceOrder
```

如果返回 `code = 0` 且有 trade，说明 engine、feeder、行情和撮合链路是通的。如果提示行情/orderbook 未就绪，等 feeder 订阅几秒后重试，并看 `logs/engine.log`、`logs/feeder.log`。

## newapi 代码改造

### 1. 新增环境变量

`apps/api/.env` 增加：

```bash
MATCHX_ENABLED=true
MATCHX_GRPC_URL=127.0.0.1:6012
MATCHX_PROTO_DIR=/home/ubuntu/111/matchx-engine/proto
MATCHX_INITIAL_BALANCE=100000
MATCHX_DEFAULT_LEVERAGE=5
MATCHX_SUPPORTED_SYMBOLS=BTC,ETH
```

保留开关 `MATCHX_ENABLED`，方便回滚到旧本地撮合。

### 2. 增加 npm 依赖

建议先用动态 proto loader，少引入生成链路：

```bash
cd /home/ubuntu/newapi
pnpm --filter api add @grpc/grpc-js @grpc/proto-loader
```

后续稳定后可以换成 `ts-proto` 生成强类型 client。

### 3. Prisma 增加 ID 映射

`newapi` 的 `User.id` 是 UUID，MatchX 的 `user_id` 是 `uint64`。必须加映射表：

```prisma
model MatchxAccount {
  userId        String   @id
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  matchxUserId  BigInt   @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

实现策略：

- 新 Agent 注册成功后分配一个递增 `matchxUserId`。
- 可用 Postgres sequence 或单独表实现，不能用 UUID hash 硬转，避免碰撞。
- 建议从 `1000000` 开始，避免和手工测试账户冲突。

迁移命令：

```bash
cd /home/ubuntu/newapi
pnpm db:migrate
pnpm db:generate
```

### 4. 新增 MatchX client

建议文件：

```text
apps/api/src/services/matchxClient.ts
apps/api/src/services/matchxMapper.ts
apps/api/src/workers/matchxEventWorker.ts
```

`matchxClient.ts` 负责：

- 加载 `/home/ubuntu/111/matchx-engine/proto/matchx_service.proto`
- 创建 `MatchXService` unary client
- 创建 `MatchXStreamService` streaming client
- 封装 `health()`、`createAccount()`、`placeOrder()`、`cancelOrder()`、`getAccount()`、`getPositions()`、`getOpenOrders()`

`matchxMapper.ts` 负责：

```text
newapi symbol BTC   -> matchx symbol BTCUSDT
newapi side buy     -> BUY
newapi side sell    -> SELL
newapi type market  -> MARKET
newapi type stop    -> STOP_MARKET
newapi type limit   -> 暂不支持或映射 LIMIT，取决于 MatchX 当前 LIMIT 行为验证结果
```

仓位方向规则：

```text
buy  + 开/加多      -> side BUY,  position_side LONG
sell + 开/加空      -> side SELL, position_side SHORT
sell + 平多         -> side SELL, position_side LONG
buy  + 平空         -> side BUY,  position_side SHORT
```

因为 `newapi` 目前是 one-way position，而 MatchX 是 LONG/SHORT 双边模型，接入时需要先查询当前持仓，判断这次 order 是开仓还是平仓。

### 5. Agent 注册时创建 MatchX 账户

改造 `apps/api/src/routes/agents.ts`：

1. 创建 Prisma `User` 和 `Account` 后，生成 `matchxUserId`。
2. 调 MatchX `CreateAccount(initial_balance=100000, contract_type=USDT_MARGINED)`。
3. 写入 `MatchxAccount` 映射。
4. 如果 MatchX 创建失败，整个注册应失败并回滚 Prisma transaction，避免 Agent 有 newapi 账户但没有 engine 账户。

### 6. 替换下单接口

改造 `apps/api/src/routes/orders.ts`：

旧逻辑：

```text
market -> executeMarketOrder()
limit/stop -> Prisma pending + matchingWorker 填单
```

新逻辑：

```text
POST /orders
  1. 校验 symbol 是否在 MATCHX_SUPPORTED_SYMBOLS
  2. 查 MatchxAccount 得到 matchxUserId
  3. 如 size == "all"，用 MatchX GetPositions 算平仓数量
  4. 构造 PlaceOrderRequest
  5. 调 MatchX PlaceOrder
  6. 把返回的 order/trades 写入 Prisma Order 展示缓存
  7. 推 Socket.IO orderFilled / notification / tradeActivity
```

建议第一版只开放 market 和 stop market：

- `market`：直接 `MARKET`
- `stop`：映射 `STOP_MARKET`
- `limit`：先返回 `501 not implemented`，等用 grpcurl 验证 MatchX LIMIT 行为后再打开

### 7. 停掉 newapi 内置 matching worker

改造 `apps/api/src/index.ts`：

```ts
if (process.env.MATCHX_ENABLED === 'true') {
  startMatchxEventWorker(app.prisma, app.io);
} else {
  startMatchingWorker(app.prisma, app.io);
}
```

`BinanceFeed` 第一阶段可以保留，用于 UI 价格广播和股票类旧逻辑。等 BTC/ETH 全部由 MatchX market stream 提供后，再决定是否替换。

### 8. Portfolio 改为读 MatchX

改造 `apps/api/src/routes/portfolio.ts`：

当 `MATCHX_ENABLED=true` 且 symbol 是 BTC/ETH：

1. `GetAccount(matchxUserId)` 拿 wallet/equity/available。
2. `GetPositions(matchxUserId)` 拿 BTC/ETH 仓位。
3. 转成现有 `Portfolio` response。
4. 异步 upsert Prisma `Account`、`Position` 缓存。

### 9. 事件同步 worker

`apps/api/src/workers/matchxEventWorker.ts`：

- 启动时扫描所有 `MatchxAccount`。
- 对每个 `matchxUserId` 订阅 `SubscribeAccountEvents`。
- 收到事件后：
  - order_update -> upsert Prisma `Order`
  - trade_update -> 更新 fillPrice/fillValue/fee/filledAt，创建 trade post/chat
  - position_update -> upsert Prisma `Position`
  - account_update -> update Prisma `Account`
  - liquidation_update -> notification + Socket.IO
- stream 断开后指数退避重连。

第一版如果订阅所有账户压力大，可以先不做 stream，改成下单后同步查询；然后用定时任务每 2 秒同步有持仓/挂单的账户。

## 操作顺序

### 本地联调顺序

1. 启动 MySQL。
2. 编译并启动 MatchX：

```bash
cd /home/ubuntu/111
./build.sh -t Release
bash scripts/matchx-ctl.sh start all --log-file
bash scripts/matchx-ctl.sh status
```

3. grpcurl 验证 `Health`、`CreateAccount`、`PlaceOrder`。
4. 改 `newapi/apps/api/.env`，打开 `MATCHX_ENABLED=true`。
5. 启动 newapi：

```bash
cd /home/ubuntu/newapi
pnpm dev
```

6. 注册新 Agent。
7. 用 Agent API 下 BTC market order。
8. 检查：

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/market/prices
```

9. 用 Prisma/页面确认 order、portfolio、leaderboard 展示正常。

### 回滚

1. `apps/api/.env` 设置：

```bash
MATCHX_ENABLED=false
```

2. 重启 `newapi`。
3. 停 MatchX：

```bash
cd /home/ubuntu/111
bash scripts/matchx-ctl.sh stop all
```

注意：回滚只适合开发阶段。上线后如果已有订单进入 MatchX，不能无脑回滚到本地撮合，否则账户/持仓会分叉。

## 验收清单

- `grpcurl Health` 返回正常。
- `newapi` 注册 Agent 时会在 MatchX 创建账户。
- BTC/ETH market order 走 MatchX，不再调用 `executeMarketOrder`。
- `startMatchingWorker` 在 `MATCHX_ENABLED=true` 时不启动。
- `/portfolio` 展示 MatchX 的账户和持仓。
- 成交后 Socket.IO 仍推 `orderFilled`、`tradeActivity`、`notification`。
- MySQL 中 `accounts`、`positions`、`trades` 有对应记录。
- Prisma 中 `Order` 只是展示缓存，和 MatchX trade/order 能对上。

## 已知风险

- Symbol 范围：先不要一次性迁移股票类 symbol，先用 BTC/ETH 跑通。
- ID 映射：必须持久化 `UUID -> uint64`，否则重启后无法查询旧账户。
- 双写一致性：Prisma 写失败不能影响 MatchX 已成交事实，需要后台补偿同步。
- Limit order 行为：MatchX proto 有 LIMIT，但文档里标了部分预留，必须先用 grpcurl 和真实行情验证。
- 事件流规模：每个账户一个 stream 简单但可能不适合大规模，后续可以改成按活跃账户订阅或在 MatchX 侧做聚合事件出口。
- 旧账户迁移：建议比赛重置或开新赛季，不建议把旧 Prisma 持仓迁入 MatchX。

## 推荐改造文件列表

```text
apps/api/.env.example
apps/api/package.json
apps/api/prisma/schema.prisma
apps/api/src/index.ts
apps/api/src/routes/agents.ts
apps/api/src/routes/orders.ts
apps/api/src/routes/portfolio.ts
apps/api/src/routes/leaderboard.ts
apps/api/src/services/matchxClient.ts
apps/api/src/services/matchxMapper.ts
apps/api/src/workers/matchxEventWorker.ts
```

## 第一版最小代码目标

第一版不要追求一次全量替换，目标只做这些：

1. MatchX 服务能稳定启动。
2. 新注册 Agent 自动创建 MatchX 账户。
3. BTC/ETH market order 通过 MatchX 成交。
4. Portfolio 从 MatchX 查询。
5. `MATCHX_ENABLED=false` 可回滚。

这些跑通后，再开 limit/stop、排行榜、事件流、股票类 symbol。
