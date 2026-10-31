# 咿呀中转（yiya-relay）v0.2.0

家庭共享的端到端加密中转 + **预约提醒（v0.2.0 新增）** + Web Push。数据仍以每台手机本地为主，服务器只在家人之间传东西、替手机记住「几点该提醒」：

- **服务器只存密文**。家庭密钥只在扫码时从手机传到手机，不经过服务器。
- 每条消息在所有收件设备确认后立即删除；没取走的最多保留 30 天。
- 180 天没有任何设备活动的家整个删除；最后一台设备退出时也删除。
- 通知文字由客户端 Service Worker 生成，服务器只转发小密文，通知里不出现健康数据。
- **预约提醒**：每台手机注册一个和家庭无关的「提醒设备」（没加入家庭的单机用户也能用），服务器只存「到点时间（UTC 毫秒）+ 可选重复规则 + 不透明密文 + 推送订阅」。
  密文用只在手机 IndexedDB 里的设备密钥加密，服务器、推送服务都解不开；到点原样推给手机的 Service Worker 解密显示。

运行环境：Node ≥ 22.13（用自带的 `node:sqlite`，无原生编译依赖），唯一依赖 `web-push`。
只监听 `127.0.0.1:8787`，对外通过 Cloudflare Tunnel `https://api.yiya.help`。

## 目录（Windows 默认，`YIYA_HOME` 可改）

| 路径 | 内容 |
|---|---|
| `D:\yiya-relay\app` | 代码（`git clone -b relay-server`），服务在 `app\server` |
| `D:\yiya-relay\data\relay.db` | SQLite（v0.2.0 起多两张表 `rdevs` / `reminders` 和 `meta`，原地自动加，不动旧数据） |
| `D:\yiya-relay\data\backup\` | `install.ps1` 每次重启前自动备份的数据库，保留最近 5 份 |
| `D:\yiya-relay\secrets\.env` | 配置 |
| `D:\yiya-relay\secrets\vapid.json` | VAPID 密钥，首次启动自动生成，**不要删**（删了所有推送订阅失效） |
| `D:\yiya-relay\logs\relay-YYYY-MM-DD.log` | 日志，保留 14 天，不含 token / 密文 |

## 部署 / 更新

```powershell
# 首次
git clone -b relay-server --depth 1 https://github.com/yuluyangguang1/mom-assistant.git D:\yiya-relay\app
powershell -ExecutionPolicy Bypass -File D:\yiya-relay\app\server\deploy\install.ps1

# 更新
git -C D:\yiya-relay\app pull --ff-only
powershell -ExecutionPolicy Bypass -File D:\yiya-relay\app\server\deploy\install.ps1
```

**从 v0.1.x 升到 v0.2.0 的一步步说明（含回滚）见 [`deploy/UPGRADE-0.2.0.md`](deploy/UPGRADE-0.2.0.md)。** VAPID 密钥不变，已开的推送订阅照常有效。

常驻方式：计划任务 `YiyaRelay`（SYSTEM，开机启动，每 5 分钟巡检一次，挂了自动拉起）。
启动命令（脚本已写好，仅供参考）：

```
"C:\Program Files\nodejs\node.exe" --disable-warning=ExperimentalWarning D:\yiya-relay\app\server\src\index.js
```

自检：`Invoke-RestMethod http://127.0.0.1:8787/v1/health`

## 接口（全部 JSON，前缀 `/v1`）

鉴权头：`Authorization: Bearer <deviceId>:<token>`。token 只在建家 / 加入时返回一次，服务器只存哈希。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ok, version, time}` |
| GET | `/push/key` | VAPID 公钥 `{publicKey}` |
| POST | `/families` | 建一个家 `{name?}` → `{familyId, deviceId, token}` |
| POST | `/join` | 扫码加入 `{familyId, invite, name?}` → `{familyId, deviceId, token, devices}` |
| POST | `/families/:fid/invites` | 生成邀请码（15 分钟、一次性）→ `{invite, expiresAt}` |
| GET | `/families/:fid/devices` | `{me, devices:[{deviceId, name, createdAt, lastSeen, push}]}` |
| PATCH | `/families/:fid/devices/me` | 改设备名 `{name}` |
| DELETE | `/families/:fid/devices/me` 或 `/:deviceId` | 自己退出 / 移除丢失的设备 |
| PUT | `/families/:fid/devices/me/push` | 保存推送订阅 `{subscription}`（只接受 Apple / Google / Mozilla / Microsoft 推送服务） |
| DELETE | `/families/:fid/devices/me/push` | 取消推送 |
| POST | `/families/:fid/messages` | 发密文 `{ct, kind?, to?}`（`ct` 为 base64url，≤ 350K 字符）→ `{seq, recipients}` |
| GET | `/families/:fid/messages?after=&limit=` | 取给我的密文 `{messages:[{seq, from, kind, ct, at}], more}` |
| POST | `/families/:fid/ack` | 确认 `{upTo}`，全部收件人确认后服务器删除 |
| POST | `/families/:fid/notify` | 推送叫醒 `{kind, ct?, to?}`（`ct` ≤ 2048 字符）→ `{sent, failed, noSub}` |

推送负载：`{t: kind, f: familyId, from: deviceId, ct, at}`，加密方式 aes128gcm（Web Push 标准）。

限额（`.env` 可调）：单家 12 台设备、待取密文 64MB、建家每 IP 每小时 6 次、加入 30 次、每设备每分钟 240 次请求、推送 12 次。

`GET /health` 从 v0.2.0 起多返回 `features: ["family", "remind"]`，App 据此判断能不能用预约提醒（旧中转返回 404 时 App 退回本地提醒）。

### 预约提醒（v0.2.0）

鉴权头：`Authorization: Bearer <提醒设备 ID r_…>:<token>`（和家庭设备是两套，互不通用）。时间一律 **UTC 毫秒**（`Date.now()`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/rdev` | 注册提醒设备 → `{deviceId, token, max}`（token 只返回这一次，服务器存哈希；每 IP 每小时 10 次） |
| DELETE | `/rdev/me` | 注销：设备和它的全部预约一起删 |
| PUT | `/rdev/me/push` | 保存推送订阅 `{subscription}`（同样只接受白名单推送服务） |
| DELETE | `/rdev/me/push` | 取消推送 |
| POST | `/rdev/me/presence` | 前台心跳 `{visible: true}` → 之后 90 秒内到点的不发系统推送（App 自己弹咿呀岛）；`{visible: false}` 立即恢复 |
| GET | `/rdev/me/reminders` | `{reminders:[{id, at, every, until, updatedAt}], max, push}`（不回传密文） |
| PUT | `/rdev/me/reminders` | **整批替换** `{reminders:[{id, at, ct, every?, until?}]}` → `{stored, skipped:[{id, why}], max}`。App 的常用路径：离线排队后一次同步，天然去重、幂等；空数组 = 全部撤销 |
| PUT | `/rdev/me/reminders/:id` | 单条新增 / 修改（同 ID 覆盖）`{at, ct, every?, until?}` |
| DELETE | `/rdev/me/reminders/:id` | 单条撤销（幂等，204） |

字段规则：`id` 1–32 位 `[A-Za-z0-9_-]`；`at` ≤ 现在 + 400 天；`every`（毫秒）≥ 15 分钟、≤ 400 天；`until` ≥ `at`；`ct` base64url ≤ 2048 字符；每台设备最多 64 条（超了整批 413、单条 409）。
一次性的已过点超过 5 分钟不收（`skipped: past`，App 本地补发）；重复的已过点自动续到下一个未来时刻。每台设备写操作每分钟 60 次。

调度：
- 状态全在 SQLite，进程里只有一个定时器（按最近到点时间排，最长 30 秒醒一次）。重启 / 崩溃后从库里接着排。
- 到点先在事务里「认领」（一次性的删掉、重复的续排到下一个未来时刻）再异步发推送：**最多送一次**——恰好在认领后、发送前崩溃会丢这一条（App 打开时本地补发兜底），但不会重复轰炸。
- 停机期间过点：6 小时内的补发，超过 6 小时的不补（重复的照常续排）。`REMIND_STALE_SEC` 可调。
- App 在前台（心跳有效）时不推；订阅失效（404 / 410）自动清掉订阅。
- 推送负载 `{t: 'rem', r: 提醒设备 ID, id: 提醒 ID, ct: 原样密文, at: 计划时刻}`，`TTL` 4 小时（手机离线时推送服务替我们留着），`Topic` = 提醒 ID（同一条没送达的旧推送被新的替换）。
- 清理：180 天没出现的提醒设备整台删除（连同预约）；日志只记条数，不记 ID / token / 推送地址 / 密文，路径里的提醒 ID 脱敏成 `:rid`。

客户端约定（App 第 335 次）：密文 = AES-256-GCM（HKDF-SHA256(设备密钥, salt `yiya/v1/hkdf`, info `yiya/v1/remind`)），AAD = `yiya/v1/remind|<提醒设备 ID>|<提醒 ID>`，明文 `{v:1, id, k: 类型, ti: 标题, b: 正文, go: 要打开的页, bid?: 宝宝 uuid, p: 补齐空格}` 按 192 字节补齐。
家人记录通知走原来的 `/families/:fid/notify`，`kind = 'rec'`，`to` = 在 meta 里声明想收（`nrec: 1`）的设备；小密文明文 `{v:1, a:'rec', n: 称呼, c: 条数, k: 类型, at}`，只有类型没有量和备注。

## 二维码里放什么（客户端约定）

`yiya://join?u=https://api.yiya.help&f=<familyId>&i=<invite>&k=<家庭密钥 base64url>&fp=<密钥指纹 16 位十六进制（64 位）>&n=<邀请人称呼，可选>`
服务器地址不写死在 App 里，以二维码 / 设置为准。

客户端（App 第 332 次）约定：
- `fp` = HKDF-SHA256(家庭密钥, salt `yiya/v1/hkdf`, info `yiya/v1/fp`) 的前 8 字节（16 位十六进制，64 位），界面按 4 组显示；加入前用它校验 `k` 没被改 / 没复制全，并在两台手机上显示给人对一眼；
- 消息密文：AES-256-GCM，AAD = `yiya/v1|<familyId>|<发送设备 ID>|<kind>`；推送小密文 AAD = `yiya/v1/push|<familyId>|<发送设备 ID>|<kind>`；
- 建家 / 加入时 `name` 一律传空字符串，真实称呼只在加密消息里互相告知；
- kind 用到 `hello` / `snap` / `rec` / `meta`（消息）和 `come`（推送）。服务器不需要理解它们。

## 测试

```
npm test
```

三个文件，全部起真实进程 + 临时目录 + 本地自签 HTTPS 假推送服务：
- `relay.test.js`：建家、加入、鉴权、收发确认删除、容量、推送与失效订阅清理、限流、移除设备、日志不泄露；
- `remind.test.js`（v0.2.0）：注册 / 鉴权、单条增改删、整批替换（去重 / 跳过坏条目 / 上限）、准点发送（用 http_ece 解开推送核对负载只有密文）、重复续排与截止、前台心跳不推、订阅失效清理、**停机重启后接着排**（补发窗口内补、窗口外跳过、重复的续排）、注册限流、日志不泄露；
- `unit.test.js`：从 v0.1.x 的库原地升级（旧数据不动、可重复打开）、重复规则 `nextAt`。
