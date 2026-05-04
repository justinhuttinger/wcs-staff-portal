; WCS Portal — kiosk configuration page
;
; Adds a custom installer page that lets the installing admin pick this
; kiosk's location. Writes C:\WCS\config.json with the chosen location and
; its corresponding ABC Financial URL before the launcher first runs.
;
; If C:\WCS\config.json already exists (re-install / repair / auto-update),
; the page is skipped so existing kiosk config is preserved.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var WcsLocationDropdown
Var WcsLocationChoice
Var WcsAbcUrl

!macro customPageAfterChangeDir
  Page custom WcsConfigPageCreate WcsConfigPageLeave
!macroend

Function WcsConfigPageCreate
  ; Preserve existing config on re-install / repair.
  IfFileExists "C:\WCS\config.json" 0 +2
    Abort

  !insertmacro MUI_HEADER_TEXT "Configure Kiosk" "Pick this kiosk's location."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "Select the location for this kiosk. The ABC Financial URL will be configured automatically and saved to C:\WCS\config.json."
  Pop $0

  ${NSD_CreateLabel} 0 36u 100% 12u "Location:"
  Pop $0

  ${NSD_CreateDropList} 0 50u 100% 90u ""
  Pop $WcsLocationDropdown
  ${NSD_CB_AddString} $WcsLocationDropdown "Salem"
  ${NSD_CB_AddString} $WcsLocationDropdown "Keizer"
  ${NSD_CB_AddString} $WcsLocationDropdown "Eugene"
  ${NSD_CB_AddString} $WcsLocationDropdown "Springfield"
  ${NSD_CB_AddString} $WcsLocationDropdown "Clackamas"
  ${NSD_CB_AddString} $WcsLocationDropdown "Milwaukie"
  ${NSD_CB_AddString} $WcsLocationDropdown "Medford"
  ${NSD_CB_SelectString} $WcsLocationDropdown "Salem"

  nsDialogs::Show
FunctionEnd

Function WcsConfigPageLeave
  ${NSD_GetText} $WcsLocationDropdown $WcsLocationChoice

  StrCpy $WcsAbcUrl ""
  ${If} $WcsLocationChoice == "Salem"
    StrCpy $WcsAbcUrl "https://prod02.abcfinancial.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=9a84c8e908a74fc494d114a36a48c969&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Keizer"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=cff423f895d340888d67812e4ee2409f&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Eugene"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=e3eae001c08148038497e1379344f0e0&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Springfield"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=310aa987194d4e4295aff333c6e69df9&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Clackamas"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=4bab4e83fd394d5d81970af7b88e4426&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Milwaukie"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=da82fd71e8ac4edb989e11207a92ec8d&wizardFirstLoad=1"
  ${ElseIf} $WcsLocationChoice == "Medford"
    StrCpy $WcsAbcUrl "https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=87c18f3a76c4400198c951d50d5d94a4&wizardFirstLoad=1"
  ${EndIf}

  ${If} $WcsLocationChoice == ""
    MessageBox MB_ICONEXCLAMATION "Please select a location."
    Abort
  ${EndIf}

  ${If} $WcsAbcUrl == ""
    MessageBox MB_ICONEXCLAMATION "No ABC URL configured for $WcsLocationChoice. Please report this to Justin."
    Abort
  ${EndIf}

  CreateDirectory "C:\WCS"
  FileOpen $0 "C:\WCS\config.json" w
  FileWrite $0 '{$\r$\n  "location": "$WcsLocationChoice",$\r$\n  "abc_url": "$WcsAbcUrl"$\r$\n}$\r$\n'
  FileClose $0
FunctionEnd
