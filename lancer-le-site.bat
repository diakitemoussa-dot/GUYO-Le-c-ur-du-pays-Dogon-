@echo off
REM Lance un serveur local et ouvre le site dans le navigateur.
REM Necessaire car le navigateur bloque les modules JavaScript (three.js, etc.)
REM quand le site est ouvert directement en double-cliquant sur index.html.
REM Cache HTTP active (24h) : sans lui (-c-1), chaque rechargement re-téléchargeait
REM les ~20 Mo d'assets et le chargement semblait toujours lent.
cd /d "%~dp0"
start "" http://localhost:8080
npx http-server -p 8080 -c 86400
