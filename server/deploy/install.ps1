<#
  咿呀中转 —— Windows 部署 / 更新脚本（以管理员身份在 PowerShell 运行）
  用法：
    powershell -ExecutionPolicy Bypass -File D:\yiya-relay\app\server\deploy\install.ps1
  可选参数：
    -Root D:\yiya-relay   -Node "C:\Program Files\nodejs\node.exe"   -Registry https://registry.npmmirror.com
  做的事：
    1. 建目录 app / data / secrets / logs，secrets 只给 SYSTEM 和 Administrators
    2. 在 app\server 里 npm.cmd ci --omit=dev
    3. 没有 .env 就写一份默认的（已有的不覆盖）
    4. 注册计划任务 YiyaRelay：SYSTEM、开机启动，另外每 5 分钟检查一次（已在运行则忽略，挂了就拉起）
    5. 重启任务并用 http://127.0.0.1:8787/v1/health 自检
  不碰：cloudflared 配置、3000 端口上的旧后端、其他软件。
#>
param(
  [string]$Root = 'D:\yiya-relay',
  [string]$Node = 'C:\Program Files\nodejs\node.exe',
  [string]$Registry = '',
  [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$TaskName = 'YiyaRelay'
$App = Join-Path $Root 'app\server'
$Secrets = Join-Path $Root 'secrets'

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

if (-not (Test-Path $Node)) { throw "找不到 Node：$Node" }
if (-not (Test-Path (Join-Path $App 'package.json'))) { throw "找不到 $App\package.json，请先 git clone -b relay-server 到 $Root\app" }
$ver = & $Node -v
Step "Node $ver"
$maj, $min = ($ver.TrimStart('v') -split '\.')[0..1] | ForEach-Object { [int]$_ }
if ($maj -lt 22 -or ($maj -eq 22 -and $min -lt 13)) { throw "需要 Node >= 22.13（node:sqlite 免开关），当前 $ver" }

Step '目录'
foreach ($d in 'data', 'secrets', 'logs') { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') {
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -Path $Secrets -AclObject $acl

Step 'npm 依赖'
$npm = Join-Path (Split-Path $Node) 'npm.cmd'
Push-Location $App
try {
  $env:Path = (Split-Path $Node) + ';' + $env:Path
  $npmArgs = @('ci', '--omit=dev', '--no-audit', '--no-fund')
  if ($Registry) { $npmArgs += "--registry=$Registry" }
  & $npm @npmArgs
  if ($LASTEXITCODE -ne 0) { throw "npm ci 失败（$LASTEXITCODE）。网络慢可加 -Registry https://registry.npmmirror.com" }
} finally { Pop-Location }

Step '.env'
$envFile = Join-Path $Secrets '.env'
if (-not (Test-Path $envFile)) {
@"
# 咿呀中转配置（修改后重启任务 YiyaRelay 生效）
HOST=127.0.0.1
PORT=$Port
ALLOWED_ORIGINS=https://yuluyangguang1.github.io,http://localhost:8000,http://127.0.0.1:8000
VAPID_SUBJECT=mailto:admin@yiya.help
MSG_TTL_DAYS=30
FAMILY_IDLE_DAYS=180
MAX_DEVICES=12
"@ | Set-Content -Path $envFile -Encoding UTF8
  Write-Host "已写入默认 $envFile"
} else { Write-Host '已有 .env，不覆盖' }

Step "计划任务 $TaskName"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App*src*index.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$action = New-ScheduledTaskAction -Execute $Node -Argument "--disable-warning=ExperimentalWarning `"$App\src\index.js`"" -WorkingDirectory $App
$tBoot = New-ScheduledTaskTrigger -AtStartup
$tWatch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($tBoot, $tWatch) -Principal $principal -Settings $settings `
  -Description '咿呀家庭共享中转（127.0.0.1:8787），代码 D:\yiya-relay\app\server' | Out-Null
Start-ScheduledTask -TaskName $TaskName

Step '自检'
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/health" -TimeoutSec 3; if ($h.ok) { $ok = $true; break } } catch {}
}
if (-not $ok) { throw "自检失败：127.0.0.1:$Port 没有响应。看 $Root\logs 里当天的 relay-*.log" }
Write-Host "OK  version=$($h.version)  listening 127.0.0.1:$Port" -ForegroundColor Green
$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App*src*index.js*" } | Select-Object -First 1
if ($p) { Write-Host ("内存（工作集）约 {0:N0} MB，pid {1}" -f ((Get-Process -Id $p.ProcessId).WorkingSet64 / 1MB), $p.ProcessId) }
