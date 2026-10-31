# 中转 v0.1.1 → v0.2.0 升级说明（Windows，D:\yiya-relay）

v0.2.0 新增「预约提醒」（App 的系统通知）。**VAPID 密钥不变**（`secrets\vapid.json` 不动），家人已经开着的推送订阅照常有效；
数据库只**新增**三张表（`rdevs` / `reminders` / `meta`），旧表和数据一行不改；`.env` 不用改（新配置都有默认值）。

全程在**管理员 PowerShell** 里操作，大约 2 分钟，服务中断约 5–10 秒。

## 升级

1. **确认现在的版本**（应显示 `0.1.1`）
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8787/v1/health
   ```

2. **记下当前代码版本**（回滚要用）
   ```powershell
   git -C D:\yiya-relay\app rev-parse --short HEAD
   ```
   把输出（例如 `855a96d`）抄下来。

3. **（可选，推荐）手动再备份一次密钥和数据**
   `install.ps1` 会在重启前自动备份数据库到 `D:\yiya-relay\data\backup\`，这一步是双保险：
   ```powershell
   $d = "D:\yiya-backup-$(Get-Date -Format yyyyMMdd-HHmm)"; New-Item -ItemType Directory $d | Out-Null
   Stop-ScheduledTask -TaskName YiyaRelay
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*yiya-relay*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   Start-Sleep -Seconds 1
   Copy-Item D:\yiya-relay\secrets\* $d -Force
   Copy-Item D:\yiya-relay\data\relay.db* $d -Force
   ```
   （先确认 node 进程已退出再拷，避免 WAL 拷到半截；`install.ps1` 会自己把任务重新拉起来，这里停掉不用管。）

4. **拉新代码**
   ```powershell
   git -C D:\yiya-relay\app fetch origin relay-server
   git -C D:\yiya-relay\app pull --ff-only
   ```
   如果提示不能 fast-forward（本地被改过），先 `git -C D:\yiya-relay\app status` 看一眼，别强推，把输出发我。

5. **重新安装 / 重启**
   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\yiya-relay\app\server\deploy\install.ps1
   ```
   它会：装依赖（依赖没变，很快）→ 停旧进程 → **备份数据库** → 重新注册计划任务 → 启动 → 自检。
   最后一行应是绿色的 `OK  version=0.2.0  listening 127.0.0.1:8787`。
   网络慢装依赖失败时加 `-Registry https://registry.npmmirror.com`。

6. **验收**
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8787/v1/health            # version 0.2.0，features 里有 remind
   Invoke-RestMethod https://api.yiya.help/v1/health            # 从外网（Cloudflare Tunnel）也一样
   Invoke-RestMethod https://api.yiya.help/v1/push/key           # 公钥和升级前一样（VAPID 没变）
   Get-Content "D:\yiya-relay\logs\relay-$(Get-Date -Format yyyy-MM-dd).log" -Tail 5
   ```
   日志里应有 `listening ... "version":"0.2.0"`，之后有人用提醒时会出现 `remind tick`（只记条数）。

## 回滚（回到 v0.1.1）

v0.2.0 只加表、不改旧表，**v0.1.1 的代码可以直接跑在升级后的数据库上**（多出来的表它不认识、也不碰），所以回滚一般不用动数据库。

1. 切回旧代码（第 2 步记下的 hash，没记就用 `855a96d`）
   ```powershell
   git -C D:\yiya-relay\app checkout 855a96d
   ```
2. 重新安装 / 重启
   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\yiya-relay\app\server\deploy\install.ps1
   ```
   看到 `OK  version=0.1.1` 即可。App 发现中转不支持提醒后会自动退回「App 打开时补发」，家庭共享不受影响。
3. 以后想再升级：`git -C D:\yiya-relay\app checkout relay-server` 然后重复「升级」第 4–6 步。

**只有在数据库本身坏了时**才需要恢复备份：
```powershell
Stop-ScheduledTask -TaskName YiyaRelay
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*yiya-relay*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-ChildItem D:\yiya-relay\data\backup | Sort-Object Name -Descending | Select-Object -First 3   # 找最新那份 relay-时间.db
Copy-Item D:\yiya-relay\data\backup\relay-<时间>.db D:\yiya-relay\data\relay.db -Force
Remove-Item D:\yiya-relay\data\relay.db-wal, D:\yiya-relay\data\relay.db-shm -ErrorAction SilentlyContinue
Copy-Item D:\yiya-relay\data\backup\relay-<时间>.db-wal D:\yiya-relay\data\relay.db-wal -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName YiyaRelay
```

## 千万别做

- 别删 / 别重新生成 `secrets\vapid.json`：所有人的推送订阅会全部失效，要每台手机重新打开通知。
- 别把 8787 端口对外开放：仍然只给本机，外网只走 Cloudflare Tunnel。
- 别在服务运行时直接拷 `relay.db`（WAL 模式下可能拷到半截）：先停任务，或者用 `install.ps1` 自动备份的那份。

## 这台机器上需要留意

- 内存只剩约 1GB：v0.2.0 多一个调度定时器，常驻内存增加可以忽略（实测和 v0.1.1 同一量级，install.ps1 最后会打印工作集）。
- 电脑关机 / 断网期间到点的提醒：恢复后 6 小时内的会补发，超过 6 小时的不补（避免早上一口气弹一串过期提醒），每天重复的会续到下一次。App 打开时会把服务器没送到的补在顶部咿呀岛里。
