@echo off
setlocal EnableDelayedExpansion
rem Hayate Rally launcher: opens the game full-screen in Microsoft Edge app mode.
rem Edge ships with Windows 10/11 and supports Xbox, PlayStation and Switch Pro pads over Bluetooth.
set "GAME=%~dp0index.html"
set "URL=file:///!GAME:\=/!"
set "URL=!URL: =%%20!"
start "" msedge --app="!URL!" --start-fullscreen --autoplay-policy=no-user-gesture-required
