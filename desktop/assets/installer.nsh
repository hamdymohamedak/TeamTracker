; Embedded during electron-builder NSIS packaging (buildResources = assets).
; On install, trust the public TeamTracker code-signing cert for this Windows user
; so Authenticode shows a known publisher — no separate .cer / PowerShell for users.
;
; Does NOT ship the private key. Does NOT "re-sign" the app at runtime (impossible
; without exposing the signing key). SmartScreen may still warn on the first
; download of Setup.exe until the user allows it once; after this install step,
; installed binaries trust the publisher locally.

!macro customInstall
  DetailPrint "Installing TeamTracker publisher trust (current user)..."
  File "/oname=$PLUGINSDIR\TeamTrackerCodeSign.cer" "${BUILD_RESOURCES_DIR}\TeamTrackerCodeSign.cer"
  ; Current-user stores: no admin elevation required
  nsExec::ExecToLog 'certutil -user -addstore -f "Root" "$PLUGINSDIR\TeamTrackerCodeSign.cer"'
  Pop $0
  DetailPrint "Trusted Root store exit: $0"
  nsExec::ExecToLog 'certutil -user -addstore -f "TrustedPublisher" "$PLUGINSDIR\TeamTrackerCodeSign.cer"'
  Pop $0
  DetailPrint "TrustedPublisher store exit: $0"
!macroend
