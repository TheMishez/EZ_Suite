; EZ Suite installer hooks (Tauri NSIS).
; Installs for all users, then turns the soundboard's mic plugin on for the default microphone(s),
; so sounds play through the real mic with no VB-CABLE. Uninstalling restores the mics.

!macro NSIS_HOOK_PREINSTALL
  ; Updating: Windows Audio may hold the old plugin DLL open. Release it so the file can be replaced.
  IfFileExists "$INSTDIR\driver\EZSoundboardApo.dll" 0 +2
    nsExec::Exec 'net stop audiosrv /y'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Adding EZ Soundboard to your microphone..."
  nsExec::ExecToLog '"$INSTDIR\driver\ezsb-mic-setup.exe" install default'
  Pop $0
  ; Make sure audio is running again even if the step above failed.
  nsExec::Exec 'net start audiosrv'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri passes /UPDATE when the uninstaller runs as part of an update: keep the mics then.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  ${If} ${Errors}
    DetailPrint "Restoring your microphone..."
    nsExec::ExecToLog '"$INSTDIR\driver\ezsb-mic-setup.exe" uninstall all --unregister'
    Pop $0
  ${EndIf}
  nsExec::Exec 'net start audiosrv'
!macroend
