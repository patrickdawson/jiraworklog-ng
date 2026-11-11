; Installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; Upgrade path from the Electron app (electron-builder, one-click, per user,
; appId com.jiraworklog.ng, installed to %LOCALAPPDATA%\Programs\jiraworklog-ng):
;
;   PREINSTALL   stop the Electron app by its full path, run its own
;                uninstaller silently, remove the leftover folder. This has to
;                happen before Tauri creates its shortcuts: both apps name them
;                JiraWorklog.lnk (Start menu, desktop), and the old uninstaller
;                deletes those names.
;   POSTINSTALL  run the new exe once with --post-install (+ --from-electron
;                after removing the old app): it backs up the database and
;                moves the autostart entry (electron.app.JiraWorklog →
;                JiraWorklog), or points an existing JiraWorklog value at the
;                installed exe. The logic is Rust, with tests:
;                crates/core/src/electron_upgrade.rs.
;
; The data folder (%APPDATA%\jiraworklog-ng) is shared by both apps; the old
; uninstaller keeps it (no deleteAppDataOnUninstall), and Tauri's own
; "delete app data" only touches %APPDATA% / %LOCALAPPDATA% \com.jiraworklog.ng.
;
; Updating one Tauri version to the next: Tauri's template updates in place
; (same uninstall key "JiraWorklog", same $INSTDIR); the Electron checks find
; nothing. One gap is closed here: for a newer version the "already installed"
; page defaults to "uninstall first", which runs our uninstaller in place
; without /UPDATE, so the template deletes the Run value "JiraWorklog" and
; autostart would be lost. PREUNINSTALL/POSTUNINSTALL keep it in that case.

; electron-builder's key: a UUID v5 of the appId, so the same on every machine.
!define JWL_ELECTRON_KEY "Software\3783ec4d-f952-5b31-97fe-6e1b5df3490b"
!define JWL_ELECTRON_DEFAULT_DIR "$LOCALAPPDATA\Programs\jiraworklog-ng"
!define JWL_ELECTRON_EXE "JiraWorklog.exe"
!define JWL_ELECTRON_UNINSTALLER "Uninstall JiraWorklog.exe"
!define JWL_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define JWL_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

Var JwlElectronDir
Var JwlFromElectron
Var JwlKeepRunValue

!macro NSIS_HOOK_PREINSTALL
  StrCpy $JwlFromElectron 0
  ReadRegStr $JwlElectronDir HKCU "${JWL_ELECTRON_KEY}" "InstallLocation"
  ${If} $JwlElectronDir == ""
    StrCpy $JwlElectronDir "${JWL_ELECTRON_DEFAULT_DIR}"
  ${EndIf}

  ${If} ${FileExists} "$JwlElectronDir\${JWL_ELECTRON_UNINSTALLER}"
    StrCpy $JwlFromElectron 1
    DetailPrint "Vorherige JiraWorklog-Version gefunden: $JwlElectronDir"

    ; Stop it by its full path through the Restart Manager: Tauri's own check,
    ; so the user gets the same "close it?" question (silent/passive: closes).
    ; Never by image name: the new exe is jiraworklog.exe, and image names
    ; match case-insensitively.
    !insertmacro CheckIfAppIsRunning "$JwlElectronDir\${JWL_ELECTRON_EXE}" "JiraWorklog (alte Version)"

    ; Its own uninstaller, silent, in place (_?=) so ExecWait really waits.
    ; It removes the program files, the shortcuts and its uninstall entry and
    ; keeps %APPDATA%\jiraworklog-ng. It does not touch the Run value.
    DetailPrint "Entferne die vorherige Version…"
    ClearErrors
    ExecWait '"$JwlElectronDir\${JWL_ELECTRON_UNINSTALLER}" /currentuser /S _?=$JwlElectronDir' $0
    ${If} ${Errors}
      StrCpy $0 2
    ${EndIf}
    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$JwlElectronDir\${JWL_ELECTRON_EXE}"
      MessageBox MB_ICONSTOP "Die vorherige JiraWorklog-Version konnte nicht entfernt werden (Code $0).$\r$\nBitte JiraWorklog beenden, unter Einstellungen → Apps deinstallieren und die Installation erneut starten. Die Daten bleiben erhalten." /SD IDOK
      Abort "Vorherige Version nicht entfernt."
    ${EndIf}
    ; Run in place, the uninstaller cannot delete itself or its folder.
    Delete "$JwlElectronDir\${JWL_ELECTRON_UNINSTALLER}"
    RMDir "$JwlElectronDir"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Always: it also moves a Run value Electron left behind when it was
  ; removed by hand, re-points an existing autostart value at $INSTDIR (the
  ; user may have picked another folder) and is a no-op otherwise.
  ${If} $JwlFromElectron = 1
    DetailPrint "Übernehme Autostart und sichere die Datenbank…"
    StrCpy $1 " --from-electron"
  ${Else}
    StrCpy $1 ""
  ${EndIf}
  ClearErrors
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --post-install$1' $0
  ${If} ${Errors}
  ${OrIf} $0 <> 0
    DetailPrint "Autostart/Sicherung unvollständig, siehe %APPDATA%\jiraworklog-ng\upgrade.log"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Run in place ($EXEDIR = $INSTDIR) means our own installer started this
  ; uninstaller ("uninstall first" on the "already installed" page, _?=).
  ; Started from Settings → Apps or by double-click, NSIS first copies the
  ; uninstaller to %TEMP% and runs that copy, so $EXEDIR differs.
  StrCpy $JwlKeepRunValue ""
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR == $INSTDIR
    ReadRegStr $JwlKeepRunValue HKCU "${JWL_RUN_KEY}" "${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $JwlKeepRunValue != ""
    ; Reinstall: put back the Run value the template just deleted; its
    ; StartupApproved value was never touched. The installer's post-install
    ; step re-points it if the folder changes.
    WriteRegStr HKCU "${JWL_RUN_KEY}" "${PRODUCTNAME}" "$JwlKeepRunValue"
  ${ElseIf} $UpdateMode <> 1
    ; Real uninstall: the template removed the Run value "JiraWorklog";
    ; drop its Task Manager approval with it.
    DeleteRegValue HKCU "${JWL_APPROVED_KEY}" "${PRODUCTNAME}"
  ${EndIf}
!macroend
