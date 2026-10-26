$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'dist-packaged\DashiNovelStudio-win32-x64\大师小说工作台.exe'
Write-Output ("EXE=" + $exe)
Write-Output ("EXISTS=" + (Test-Path -LiteralPath $exe))

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '大师小说工作台.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = [System.IO.Path]::GetDirectoryName($exe)
$shortcut.IconLocation = ($exe + ',0')
$shortcut.Description = '大师小说工作台 - AI 长篇小说创作工作台'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output ("SHORTCUT=" + $shortcutPath)
