// electron-builder --win portable у нас всегда падает на скачивании winCodeSign
// (нужен для code-signing, которым мы не пользуемся - см. lk-desktop/README или
// сессию 009 в _СЕССИИ) - НО он всё равно успевает пересобрать dist/win-unpacked/
// перед падением. Пропадает только последний шаг - патчинг иконки/версии в exe
// через rcedit, который в норме делает сам electron-builder. rcedit не связан с
// code-signing и уже лежит на диске (7-Zip успевает распаковать почти весь архив
// winCodeSign, кроме пары mac-симлинков) - просто зовём его напрямую отдельным
// шагом после сборки.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE_ROOT = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
const EXE_PATH = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Спам-монитор FLATME.exe');
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

function findRcedit() {
  if (!fs.existsSync(CACHE_ROOT)) return null;
  const dirs = fs.readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(CACHE_ROOT, d.name))
    .filter((p) => fs.existsSync(path.join(p, 'rcedit-x64.exe')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs.length > 0 ? path.join(dirs[0], 'rcedit-x64.exe') : null;
}

const rcedit = findRcedit();
if (!rcedit) {
  console.warn('apply-icon: rcedit-x64.exe не найден в кэше electron-builder - иконка НЕ применена (соберите хотя бы раз через npm run dist, чтобы кэш появился).');
  process.exit(0);
}
if (!fs.existsSync(EXE_PATH)) {
  console.warn(`apply-icon: не найден ${EXE_PATH} - сначала нужен успешный npm run dist.`);
  process.exit(0);
}
if (!fs.existsSync(ICON_PATH)) {
  console.warn(`apply-icon: не найден ${ICON_PATH}.`);
  process.exit(0);
}

execFileSync(rcedit, [EXE_PATH, '--set-icon', ICON_PATH], { stdio: 'inherit' });
console.log('apply-icon: иконка применена -', EXE_PATH);
