<#
.SYNOPSIS
  Installs, upgrades and uninstalls JiraWorklog on a throwaway Windows machine
  and checks every step. CI runs it on fresh GitHub runners (job
  "installer-test" in .github/workflows/ci.yml), one scenario per runner.

.DESCRIPTION
  NEVER run this on your own PC. It installs and removes JiraWorklog for the
  current user, kills the installed app's processes and writes autostart
  values. It refuses to run unless $env:CI is "true" (set on GitHub runners)
  or -ThrowawayMachine is given, and it stops if any JiraWorklog is already
  installed.

  Scenarios (the cases of "Manual test: upgrade from Electron" in
  docs/tauri-migration.md, silent):
    electron-running   Electron 0.8.0 running, autostart on      → upgrade
    electron-stopped   Electron 0.8.0 not running, autostart off → upgrade
    electron-disabled  Electron autostart disabled in Task Manager → upgrade
    tauri-update       Tauri → Tauri: "uninstall first" (the GUI default for a
                       newer version), in-place update with the app running,
                       then uninstall as Settings → Apps does it

  After an Electron upgrade the new app is started once: it must migrate the
  database, keep the entries and settings and stay up.

  The silent installer skips the "already installed" page, so the "uninstall
  first" choice is reproduced by running the old uninstaller in place
  (/S _?=<dir>), the same command the installer runs for it. Not covered: the
  GUI dialogs themselves, and "delete app data" on uninstall (a checkbox that
  silent mode cannot set).

.EXAMPLE
  pwsh -File scripts/installer-test/installer-test.ps1 -Scenario electron-running `
    -NewInstaller target/release/bundle/nsis/JiraWorklog_0.10.0_x64-setup.exe `
    -OldInstaller JiraWorklog-0.8.0-setup.exe
#>
param(
  [Parameter(Mandatory)]
  [ValidateSet("electron-running", "electron-stopped", "electron-disabled", "tauri-update")]
  [string] $Scenario,
  [Parameter(Mandatory)] [string] $NewInstaller,
  [string] $OldInstaller,
  [switch] $ThrowawayMachine
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ── Paths ────────────────────────────────────────────────────────────────────

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dbTool = Join-Path $PSScriptRoot "db.mjs"
$upgradeCheck = Join-Path $repo "scripts\sandbox\upgrade-check.ps1"

$electronDir = Join-Path $env:LOCALAPPDATA "Programs\jiraworklog-ng"
$electronExe = Join-Path $electronDir "JiraWorklog.exe"
$tauriDir = Join-Path $env:LOCALAPPDATA "JiraWorklog"
$tauriExe = Join-Path $tauriDir "jiraworklog.exe"
$dataDir = Join-Path $env:APPDATA "jiraworklog-ng"
$db = Join-Path $dataDir "jiraworklog.db"
$upgradeLog = Join-Path $dataDir "upgrade.log"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$approvedKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$uninstKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$electronUninst = "$uninstKey\3783ec4d-f952-5b31-97fe-6e1b5df3490b"
$tauriUninst = "$uninstKey\JiraWorklog"
$startLink = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\JiraWorklog.lnk"
$deskLink = Join-Path ([Environment]::GetFolderPath("Desktop")) "JiraWorklog.lnk"

# The newest migration: the new app must have applied it after its first start.
$journal = Get-Content (Join-Path $repo "drizzle\meta\_journal.json") -Raw | ConvertFrom-Json
$latestMigration = ($journal.entries | Measure-Object -Property when -Maximum).Maximum

# ── Helpers ──────────────────────────────────────────────────────────────────

$script:fails = 0

function Step([string] $text) { Write-Output ""; Write-Output "## $(Get-Date -Format HH:mm:ss) $text" }

function Check([string] $name, [bool] $ok, [string] $detail = "") {
  $tag = if ($ok) { "PASS" } else { "FAIL"; $script:fails++ }
  Write-Output ("{0}  {1}{2}" -f $tag, $name, $(if ($detail) { "  ($detail)" } else { "" }))
}

function RegValue([string] $key, [string] $name) {
  $p = Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
  if ($p) { return $p.$name } else { return $null }
}

function SetApproved([string] $name, [byte] $state) {
  # Task Manager's format: 12 bytes, state (2 = on, 3 = off) + 3 zero bytes +
  # FILETIME. Disabling stores when it happened; enabling stores zero. The app
  # (like tauri-plugin-autostart) reads a non-zero time as "disabled".
  if (-not (Test-Path $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }
  $bytes = [byte[]]::new(12)
  $bytes[0] = $state
  if ($state -eq 3) {
    [BitConverter]::GetBytes((Get-Date).ToFileTimeUtc()).CopyTo($bytes, 4)
  }
  New-ItemProperty -Path $approvedKey -Name $name -PropertyType Binary -Value $bytes -Force | Out-Null
}

function ProcessesOf([string] $exe) {
  # By full path, never by image name: both apps are called JiraWorklog.exe.
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe })
}

# @(...) around every call that counts: a function returning an empty array
# returns $null, and strict mode has no .Count on $null.
function IsRunning([string] $exe) { @(ProcessesOf $exe).Count -gt 0 }

function SetRunValue([string] $name, [string] $value) {
  # A fresh CI user profile has no Run key yet; a normal one always has.
  if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
  New-ItemProperty -Path $runKey -Name $name -Value $value -Force | Out-Null
}

function StopByPath([string] $exe) {
  ProcessesOf $exe | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  WaitFor "$exe stopped" 30 { -not (IsRunning $exe) }
}

function WaitFor([string] $what, [int] $seconds, [scriptblock] $condition) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $condition) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out after $seconds s waiting for: $what"
}

function RunInstaller([string] $exe, [string[]] $arguments, [int] $timeoutSeconds = 300) {
  # Write-Host: anything written to the output stream would join the return value.
  Write-Host "$(Get-Date -Format HH:mm:ss) > $exe $($arguments -join ' ')"
  # Waits for the installer process only. Start-Process -Wait would also wait
  # for every process it leaves behind (a crash reporter, an app it starts)
  # and could hang the job. An uninstaller that re-runs itself from %TEMP%
  # exits at once; its caller waits for the result instead.
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
  $null = $p.Handle # keep the handle, or ExitCode is empty after the exit
  if (-not $p.WaitForExit($timeoutSeconds * 1000)) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    throw "Timed out after $timeoutSeconds s: $exe $($arguments -join ' ')"
  }
  Write-Host "$(Get-Date -Format HH:mm:ss)   exit $($p.ExitCode)"
  return $p.ExitCode
}

function CrashesSince([datetime] $since) {
  # The Application log's "Application Error" entries (event 1000) name the
  # faulting app and module. Only those since $since: an older one, of any
  # app, would name the wrong module. The entry appears a moment after the
  # crash (0.2 s in a test), so wait a little first.
  Start-Sleep -Seconds 2
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; Id = 1000; StartTime = $since } -ErrorAction SilentlyContinue)
  if ($events.Count -eq 0) { return "no Application Error event since $($since.ToString('HH:mm:ss'))" }
  return ($events | ForEach-Object { "$($_.TimeCreated.ToString('HH:mm:ss')) $($_.Message -replace '\s+', ' ')" }) -join " | "
}

function StartHeartbeat([string] $file) {
  # A hung job has left no log at all so far: the runner stopped reporting,
  # ignored the cancel and never ran the steps that collect the data. Every
  # 15 s this writes the installer and app processes to a file the workflow
  # collects, and to the step log, which the browser shows live during a hang.
  Start-ThreadJob -ArgumentList $file -ScriptBlock {
    param($file)
    while ($true) {
      $now = Get-Date -Format HH:mm:ss
      try {
        # -match ignores case. The command line tells apart the Electron
        # processes, which all run JiraWorklog.exe (--type=renderer, ...).
        $procs = Get-CimInstance Win32_Process -ErrorAction Stop |
          Where-Object { "$($_.ExecutablePath)" -match "jiraworklog|setup|uninst|~nsu" } |
          ForEach-Object {
            $cmd = if ($_.CommandLine) { $_.CommandLine } else { $_.ExecutablePath }
            "  $($_.ProcessId) (parent $($_.ParentProcessId)) $cmd"
          }
        $lines = @("heartbeat $now") + @($procs)
      } catch {
        $lines = @("heartbeat $now failed: $_")
      }
      Add-Content -Path $file -Value $lines
      # One write, so the lines stay together next to the script's output.
      [Console]::Out.WriteLine($lines -join [Environment]::NewLine)
      Start-Sleep -Seconds 15
    }
  } | Out-Null
}

function DbState {
  if (-not (Test-Path $db)) { return $null }
  $json = node $dbTool state $db 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
  return $json | ConvertFrom-Json
}

function SeedDb {
  node $dbTool seed $db
  if ($LASTEXITCODE -ne 0) { throw "Seeding the database failed." }
}

function UpgradeCheck([string] $stage, [string] $autostart) {
  $out = & pwsh -NoProfile -File $upgradeCheck -Stage $stage -Autostart $autostart
  $out | Write-Output
  $failed = @($out | Where-Object { $_ -like "FAIL*" }).Count
  Check "upgrade-check.ps1 -Stage $stage -Autostart $autostart" ($failed -eq 0) "$failed failed"
}

function LogHas([string] $text) {
  (Test-Path $upgradeLog) -and ((Get-Content $upgradeLog -Raw).Contains($text))
}

function MigrationBackups {
  # The app's own backup before migrating: backup-<stamp>, not backup-electron-<stamp>.
  @(Get-ChildItem $dataDir -Filter "jiraworklog.db.backup-*" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike "*backup-electron-*" })
}

function StartNewAppAndCheckData([int] $expectedEntries, [string] $expectedTheme) {
  Start-Process -FilePath $tauriExe | Out-Null
  WaitFor "new app migrated the database to $latestMigration" 90 {
    $s = DbState
    $s -and $s.lastMigration -ge $latestMigration
  }
  # Give a crash on start a moment to happen.
  Start-Sleep -Seconds 5
  Check "New app still running after start" (IsRunning $tauriExe)
  $s = DbState
  Check "Entries kept" ($s.entries -eq $expectedEntries) "$($s.entries): $($s.descriptions -join ', ')"
  Check "Theme kept" ($s.themeMode -eq $expectedTheme) "$($s.themeMode)"
  Check "recent_entries_limit has its default" ($s.recentEntriesLimit -eq 15) "$($s.recentEntriesLimit)"
  StopByPath $tauriExe
}

# ── Safety ───────────────────────────────────────────────────────────────────

if ($env:CI -ne "true" -and -not $ThrowawayMachine) {
  throw "Refusing to run: this script installs and removes JiraWorklog. Run it on a throwaway machine (CI, Sandbox, VM) with -ThrowawayMachine."
}
foreach ($existing in @($electronUninst, $tauriUninst)) {
  if (Test-Path $existing) { throw "Refusing to run: JiraWorklog is already installed here ($existing)." }
}
if ((Test-Path $db)) { throw "Refusing to run: a JiraWorklog database already exists at $db." }

$NewInstaller = (Resolve-Path $NewInstaller).Path
if ($Scenario -like "electron-*") {
  if (-not $OldInstaller) { throw "-OldInstaller is required for $Scenario." }
  $OldInstaller = (Resolve-Path $OldInstaller).Path
}
Write-Output "# Scenario $Scenario"
Write-Output "new installer: $NewInstaller"
if ($OldInstaller) { Write-Output "old installer: $OldInstaller" }
Write-Output "latest migration: $latestMigration"
if ($env:INSTALLER_TEST_HEARTBEAT) {
  StartHeartbeat $env:INSTALLER_TEST_HEARTBEAT
  Write-Output "heartbeat: $env:INSTALLER_TEST_HEARTBEAT"
}

# ── Scenarios ────────────────────────────────────────────────────────────────

if ($Scenario -like "electron-*") {
  Step "Install Electron 0.8.0 and create its database"
  # The old electron-builder installer sometimes crashes on a runner
  # (0xC0000005) within a second and installs nothing, three times in a row
  # on 2026-11-12. It is only the starting point here, so retry it with a
  # growing pause and log which module crashed.
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    $started = Get-Date
    $code = RunInstaller $OldInstaller @("/S")
    if ($code -eq 0 -and (Test-Path $electronExe)) { break }
    Write-Output "INFO  Electron install attempt $attempt failed (exit $code): $(CrashesSince $started)"
    if ($attempt -lt 5) { Start-Sleep -Seconds (10 * $attempt) }
  }
  Check "Electron installer exit code 0" ($code -eq 0) "$code"
  WaitFor "Electron exe installed" 60 { Test-Path $electronExe }
  StopByPath $electronExe # in case the installer started it
  Start-Process -FilePath $electronExe | Out-Null
  WaitFor "Electron app created its database" 120 { $s = DbState; $s -and $s.ready }
  SeedDb

  $autostart = if ($Scenario -eq "electron-stopped") { "Off" } else { "On" }
  if ($autostart -eq "On") {
    # What the old app's setLoginItemSettings wrote: the unquoted exe path.
    SetRunValue "electron.app.JiraWorklog" $electronExe
  }
  if ($Scenario -eq "electron-disabled") {
    SetApproved "electron.app.JiraWorklog" 3
  }
  if ($Scenario -ne "electron-running") {
    StopByPath $electronExe
  }
  UpgradeCheck "Electron" $autostart
  Check "Electron running before the upgrade = $($Scenario -eq 'electron-running')" `
    ((IsRunning $electronExe) -eq ($Scenario -eq "electron-running"))

  Step "Install the new version over it"
  $code = RunInstaller $NewInstaller @("/S")
  Check "New installer exit code 0" ($code -eq 0) "$code"
  Check "Electron app no longer running" (-not (IsRunning $electronExe))
  Check "New app not started by the silent installer" (-not (IsRunning $tauriExe))

  $expectedAutostart = if ($Scenario -eq "electron-running") { "On" } else { "Off" }
  UpgradeCheck "Tauri" $expectedAutostart
  switch ($Scenario) {
    "electron-running" { Check "upgrade.log: autostart carried over" (LogHas "autostart: carried over from Electron") }
    "electron-stopped" { Check "upgrade.log: autostart off" (LogHas "autostart: off, nothing set") }
    "electron-disabled" {
      Check "upgrade.log: Electron autostart was disabled" (LogHas "was disabled in Task Manager")
      Check "StartupApproved electron.app.JiraWorklog removed" ($null -eq (RegValue $approvedKey "electron.app.JiraWorklog"))
    }
  }

  Step "Start the new app on the old data"
  Check "No migration backup before the first start" (@(MigrationBackups).Count -eq 0)
  StartNewAppAndCheckData 2 "dark"
  Check "Migration backup made on the first start" (@(MigrationBackups).Count -ge 1) ((@(MigrationBackups) | ForEach-Object Name) -join ", ")
}

if ($Scenario -eq "tauri-update") {
  $runValue = "$tauriExe " # tauri-plugin-autostart: unquoted path plus one space

  Step "Fresh install"
  $code = RunInstaller $NewInstaller @("/S")
  Check "Installer exit code 0" ($code -eq 0) "$code"
  Check "Exe installed" (Test-Path $tauriExe)
  Check "Uninstall entry" (Test-Path $tauriUninst) "$(RegValue $tauriUninst 'DisplayVersion')"
  Check "No Electron backup on a fresh install" (@(Get-ChildItem $dataDir -Filter "*backup-electron-*" -ErrorAction SilentlyContinue).Count -eq 0)
  Start-Process -FilePath $tauriExe | Out-Null
  WaitFor "new app created its database" 90 { $s = DbState; $s -and $s.lastMigration -ge $latestMigration }
  SeedDb
  # What Einstellungen → Desktop → Autostart writes.
  SetRunValue "JiraWorklog" $runValue
  SetApproved "JiraWorklog" 2

  Step "Update with ""uninstall first"" while the app runs"
  Check "App running before the update" (IsRunning $tauriExe)
  # The installer's command for that choice: the old uninstaller in place.
  $code = RunInstaller (Join-Path $tauriDir "uninstall.exe") @("/S", "_?=$tauriDir")
  Check "Uninstaller exit code 0" ($code -eq 0) "$code"
  Check "App closed by the uninstaller" (-not (IsRunning $tauriExe))
  Check "Exe removed" (-not (Test-Path $tauriExe))
  Check "Run value kept by the hooks" ((RegValue $runKey "JiraWorklog") -ceq $runValue) "[$(RegValue $runKey 'JiraWorklog')]"
  Check "StartupApproved value kept" ($null -ne (RegValue $approvedKey "JiraWorklog"))
  # The installer then removes what the in-place uninstaller could not.
  Remove-Item (Join-Path $tauriDir "uninstall.exe") -Force -ErrorAction SilentlyContinue
  $code = RunInstaller $NewInstaller @("/S")
  Check "Installer exit code 0" ($code -eq 0) "$code"
  Check "Exe installed again" (Test-Path $tauriExe)
  Check "Run value unchanged" ((RegValue $runKey "JiraWorklog") -ceq $runValue) "[$(RegValue $runKey 'JiraWorklog')]"
  Check "upgrade.log: autostart kept" (LogHas "autostart: on, already points here")
  Check "Start menu link -> app" ((New-Object -ComObject WScript.Shell).CreateShortcut($startLink).TargetPath -eq $tauriExe)
  Check "Desktop link -> app" ((New-Object -ComObject WScript.Shell).CreateShortcut($deskLink).TargetPath -eq $tauriExe)

  Step "Update in place while the app runs"
  Start-Process -FilePath $tauriExe | Out-Null
  WaitFor "app running" 30 { IsRunning $tauriExe }
  $code = RunInstaller $NewInstaller @("/S")
  Check "Installer exit code 0" ($code -eq 0) "$code"
  Check "App closed by the installer" (-not (IsRunning $tauriExe))
  Check "Run value unchanged" ((RegValue $runKey "JiraWorklog") -ceq $runValue) "[$(RegValue $runKey 'JiraWorklog')]"
  Check "One uninstall entry" (@(Get-ChildItem $uninstKey | Where-Object { "$($_.GetValue('DisplayName'))" -like "JiraWorklog*" }).Count -eq 1)
  Check "No Electron backup" (@(Get-ChildItem $dataDir -Filter "*backup-electron-*" -ErrorAction SilentlyContinue).Count -eq 0)
  StartNewAppAndCheckData 2 "dark"

  Step "Uninstall as Settings → Apps does"
  $uninstallString = RegValue $tauriUninst "UninstallString"
  $uninstaller = $uninstallString.Trim('"')
  $code = RunInstaller $uninstaller @("/S")
  Check "Uninstaller exit code 0" ($code -eq 0) "$code"
  # NSIS runs a copy of the uninstaller from %TEMP%\~nsu*.tmp and the started
  # one exits at once: wait until that copy is done.
  $tempCopies = { @(Get-CimInstance Win32_Process | Where-Object { "$($_.ExecutablePath)" -like "$env:TEMP\~nsu*" }) }
  WaitFor "uninstaller copy in %TEMP% finished" 120 { @(& $tempCopies).Count -eq 0 -and -not (Test-Path $tauriExe) }
  Check "Uninstall entry gone" (-not (Test-Path $tauriUninst))
  Check "Run value gone" ($null -eq (RegValue $runKey "JiraWorklog"))
  Check "StartupApproved value gone" ($null -eq (RegValue $approvedKey "JiraWorklog"))
  Check "Start menu link gone" (-not (Test-Path $startLink))
  Check "Desktop link gone" (-not (Test-Path $deskLink))
  Check "Database kept" (Test-Path $db)
}

# ── Result ───────────────────────────────────────────────────────────────────

Write-Output ""
if (Test-Path $upgradeLog) {
  Write-Output "-- upgrade.log --"
  Get-Content $upgradeLog | Write-Output
}
Write-Output "== $Scenario`: $($script:fails) failed =="
if ($script:fails -gt 0) { exit 1 }
