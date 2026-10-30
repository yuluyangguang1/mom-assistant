# 咿呀中转（yiya-relay）

家庭共享的端到端加密中转 + Web Push。数据仍以每台手机本地为主，服务器只在家人之间传东西：

- **服务器只存密文**。家庭密钥只在扫码时从手机传到手机，不经过服务器。
- 每条消息在所有收件设备确认后立即删除；没取走的最多保留 30 天。
- 180 天没有任何设备活动的家整个删除；最后一台设备退出时也删除。
- 通知文字由客户端 Service Worker 生成，服务器只转发小密文，通知里不出现健康数据。

运行环境：Node ≥ 22.13（用自带的 `node:sqlite`，无原生编译依赖），唯一依赖 `web-push`。
只监听 `127.0.0.1:8787`，对外通过 Cloudflare Tunnel `https://api.yiya.help`。

## 目录（Windows 默认，`YIYA_HOME` 可改）

| 路径 | 内容 |
|---|---|
| `D:\yiya-relay\app` | 代码（`git clone -b relay-server`），服务在 `app\server` |
| `D:\yiya-relay\data\relay.db` | SQLite |
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

## 二维码里放什么（客户端约定）

`yiya://join?u=https://api.yiya.help&f=<familyId>&i=<invite>&k=<家庭密钥 base64url>`
服务器地址不写死在 App 里，以二维码 / 设置为准。

## 测试

```
npm test
```

起真实进程 + 临时目录 + 本地自签 HTTPS 假推送服务，覆盖建家、加入、鉴权、收发确认删除、容量、推送与失效订阅清理、限流、移除设备、日志不泄露。
