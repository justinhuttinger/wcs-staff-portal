; WCS Portal — installer customizations
;
; There is no location page any more: the list of clubs lives in the portal
; (Admin -> Clubs), so the installer can't carry it. A PC set up by Action1
; gets its club from scripts/action1/set-wcs-club.ps1; a manual install shows
; the in-app location picker on first launch (launcher/src/main.js). An
; existing C:\WCS\config.json is never touched, so re-installs keep their club.

; ---------------------------------------------------------------------------
; Silent updates for per-machine installs.
;
; Program Files isn't writable by the app, so an in-app update would raise a
; UAC prompt. Instead install the SYSTEM "WCS <app> Updater" scheduled task
; (overnight + at boot + on demand) that installs new builds with /S, plus a
; "WCS <app> Launch" task that relaunches the app in the logged-in session.
; Same script Action1 runs: scripts/action1/install-portal.ps1 (the flavor,
; portal or abc, is read from resources\app-update.yml). On uninstall the
; tasks remove themselves the next time they run.
; ---------------------------------------------------------------------------

!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\updater\install-portal.ps1" -RegisterOnly -InstallDir "$INSTDIR"'
  Pop $0
!macroend
