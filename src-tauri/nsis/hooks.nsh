; Installer hooks (Tauri NSIS), shared by EZ Suite, EZ Soundboard and EZ Reticle.
;
; EZ Suite / EZ Soundboard install for all users, then turn the soundboard's mic plugin on for the
; default microphone(s), so sounds play through the real mic with no VB-CABLE. Uninstalling
; restores the mics. EZ Reticle has no mic plugin and installs per user.
;
; Moving from the old Electron apps (EZ Reticle 1.x, EZ Soundboard 1.x): their in-app updater runs
; this installer with "/S --updated --force-run". Before any file is copied, the old app is
; uninstalled (for the soundboard without touching the mics), and the new app is started at the end.

; electron-builder's registry key ids: uuid v5 of the old appId in electron-builder's namespace.
!define EZ_OLD_RETICLE_GUID "04b329d4-60ed-5dfb-b59b-60caa0c6499e"
!define EZ_OLD_SOUNDBOARD_GUID "e14e220f-45c0-5201-b32e-48584a151fb4"

; Puts the old Electron app's folder in $R8 (empty when it isn't installed) and the matching
; uninstaller switch in $R7.
!macro EZ_FIND_ELECTRON GUID
  StrCpy $R8 ""
  StrCpy $R7 "/currentuser"
  ReadRegStr $R8 HKCU "Software\${GUID}" "InstallLocation"
  ${If} $R8 == ""
    StrCpy $R7 "/allusers"
    ReadRegStr $R8 HKLM64 "Software\${GUID}" "InstallLocation"
  ${EndIf}
  ${If} $R8 == ""
    ReadRegStr $R8 HKLM32 "Software\${GUID}" "InstallLocation"
  ${EndIf}
!macroend

; Runs the old app's uninstaller silently and waits for it (_?= keeps it from copying itself to
; %TEMP% and returning at once). EXTRA is passed on, e.g. --updated.
!macro EZ_REMOVE_ELECTRON GUID UNINSTALLER EXTRA
  !insertmacro EZ_FIND_ELECTRON "${GUID}"
  ${If} $R8 != ""
  ${AndIf} ${FileExists} "$R8\${UNINSTALLER}"
    DetailPrint "Removing the old version..."
    ExecWait '"$R8\${UNINSTALLER}" /S $R7 ${EXTRA} _?=$R8' $R9
    Delete "$R8\${UNINSTALLER}"
    ; Electron's own folders (this app doesn't use these names), then the folder if it's empty.
    RMDir /r "$R8\resources"
    RMDir /r "$R8\locales"
    RMDir "$R8"
  ${EndIf}
!macroend

; Puts the install folder of the other app that carries the mic plugin in $R2 (EZ Suite for
; EZ Soundboard and the other way round), or "" when it isn't installed.
!macro EZ_OTHER_MIC_APP
  StrCpy $R2 ""
  !if "${PRODUCTNAME}" == "EZ Suite"
    !define /redef EZ_OTHER "EZ Soundboard"
  !else
    !define /redef EZ_OTHER "EZ Suite"
  !endif
  ReadRegStr $R2 HKLM64 "Software\EZGGco\${EZ_OTHER}" ""
  ${If} $R2 == ""
    ReadRegStr $R2 HKLM32 "Software\EZGGco\${EZ_OTHER}" ""
  ${EndIf}
  ${If} $R2 != ""
  ${AndIfNot} ${FileExists} "$R2\driver\ezsb-mic-setup.exe"
    StrCpy $R2 ""
  ${EndIf}
!macroend

; The hooks use $R0-$R2 and $R7-$R9; keep the installer's own values intact around them.
!macro EZ_SAVE
  Push $R2
  Push $R7
  Push $R8
  Push $R9
!macroend
!macro EZ_RESTORE
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R2
!macroend

!macro EZ_RUN_AFTER_ELECTRON_UPDATE
  ; electron-updater asks for the app to be started again with --force-run.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro EZ_SAVE
!if "${PRODUCTNAME}" == "EZ Reticle"
  !insertmacro EZ_REMOVE_ELECTRON "${EZ_OLD_RETICLE_GUID}" "Uninstall EZ Reticle.exe" ""
  ; The old app's start-with-Windows entry (the new one carries the setting over itself).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ezggco.reticle"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.EZ Reticle"
!else
  ; Updating: Windows Audio may hold the old plugin DLL open. Release it so the file can be replaced.
  IfFileExists "$INSTDIR\driver\EZSoundboardApo.dll" 0 +3
    nsExec::Exec 'net stop audiosrv /y'
    Pop $0
  !if "${PRODUCTNAME}" == "EZ Soundboard"
    !insertmacro EZ_FIND_ELECTRON "${EZ_OLD_SOUNDBOARD_GUID}"
    ${If} $R8 != ""
      nsExec::Exec 'net stop audiosrv /y'
      Pop $0
      ; --updated: the old uninstaller then leaves the mics you picked alone; the plugin is
      ; pointed at the new copy after the files are in.
      !insertmacro EZ_REMOVE_ELECTRON "${EZ_OLD_SOUNDBOARD_GUID}" "Uninstall EZ Soundboard.exe" "--updated"
      nsExec::Exec 'net stop audiosrv /y'
      Pop $0
      RMDir /r "$R8\resources"
    ${EndIf}
  !endif
!endif
  !insertmacro EZ_RESTORE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro EZ_SAVE
!if "${PRODUCTNAME}" != "EZ Reticle"
  DetailPrint "Adding EZ Soundboard to your microphone..."
  nsExec::ExecToLog '"$INSTDIR\driver\ezsb-mic-setup.exe" install default'
  Pop $0
  ; Make sure audio is running again even if the step above failed.
  nsExec::Exec 'net start audiosrv'
  Pop $0
!endif
  !insertmacro EZ_RESTORE
  !insertmacro EZ_RUN_AFTER_ELECTRON_UPDATE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro EZ_SAVE
!if "${PRODUCTNAME}" != "EZ Reticle"
  ; Tauri passes /UPDATE when the uninstaller runs as part of an update: keep the mics then.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  ${If} ${Errors}
    !insertmacro EZ_OTHER_MIC_APP
    ${If} $R2 != ""
      ; The other app still uses the plugin: hand it over instead of switching the mics off.
      DetailPrint "Handing the microphone plugin over to the other EZ app..."
      nsExec::ExecToLog '"$R2\driver\ezsb-mic-setup.exe" register'
      Pop $0
    ${Else}
      DetailPrint "Restoring your microphone..."
      nsExec::ExecToLog '"$INSTDIR\driver\ezsb-mic-setup.exe" uninstall all --unregister'
      Pop $0
    ${EndIf}
  ${EndIf}
  nsExec::Exec 'net start audiosrv'
  Pop $0
!endif
  !insertmacro EZ_RESTORE
!macroend
