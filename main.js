const { app, BrowserWindow, screen, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// Боевой кабинет по умолчанию; для тестов можно переопределить через
// переменную окружения LK_URL (например, на локальный мок-сервер).
const CABINET_URL = process.env.LK_URL || 'https://flatme-lk.acpotapov.webtm.ru/cabinet';

// Заголовок окна фиксированный - не зависит от того, какая именно страница
// сайта сейчас загружена (у /cabinet, /spam-monitor, /login разные <title> -
// без этого заголовок окна "прыгал" при переходах, например показывал
// "FLATME - Номера", если внутри приложения открыть другую страницу сайта).
const WINDOW_TITLE = 'Спам-монитор FLATME';

const SITE_ORIGIN = new URL(CABINET_URL).origin;

// Приложение должно показывать ТОЛЬКО спам-монитор (кабинет менеджера или его
// версия для владельца) - остальные страницы сайта (админка "/", "/numbers",
// "/team" и т.п.) не адаптированы под маленькое окно и не нужны здесь, полный
// сайт для них - обычный браузер. Скрытые пункты меню (см. spam_monitor.html)
// это уже прикрывают, но ссылку можно открыть и другим способом - поэтому
// дополнительно блокируем сами переходы на уровне приложения.
const ALLOWED_PATH_PREFIXES = ['/cabinet', '/spam-monitor', '/login', '/logout'];

function isAllowedPath(pathname) {
  return ALLOWED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function guardNavigation(event, urlString, win) {
  let target;
  try {
    target = new URL(urlString);
  } catch (e) {
    event.preventDefault();
    return;
  }
  if (target.origin === SITE_ORIGIN && isAllowedPath(target.pathname)) {
    return; // свой сайт, разрешённая страница - пропускаем как есть
  }
  event.preventDefault();
  if (target.origin === SITE_ORIGIN && target.pathname === '/') {
    // "/" - главная админка владельца, куда ведёт вход по владельческим
    // логину/паролю (см. login_submit в web_server.py) - в этом окне ей не
    // место, сразу уводим на спам-монитор вместо простого блокирования.
    // loadURL откладываем на следующий тик - вызов синхронно внутри самого
    // will-navigate/will-redirect (сразу после preventDefault) у Electron
    // ненадёжно приводит к реальной новой навигации.
    setImmediate(() => win.loadURL(`${SITE_ORIGIN}/spam-monitor`));
  }
}

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 225;
const MIN_WIDTH = 340;
const MIN_HEIGHT = 195;
// Верхняя граница на случай, если окно раньше растянули руками (например, во
// время более ранних тестов) - без этого сохранённый огромный размер из
// window-state.json подхватывался бы вечно и переставала работать компактная
// вёрстка (@media max-width: 460px в cabinet.html/spam_monitor.html).
const MAX_WIDTH = 460;
const MAX_HEIGHT = 640;

const stateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const state = JSON.parse(raw);
    if (typeof state.width === 'number' && typeof state.height === 'number') {
      state.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, state.width));
      state.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, state.height));
      return state;
    }
  } catch (e) {
    // файла ещё нет или он битый - используем размеры по умолчанию
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  try {
    fs.writeFileSync(stateFile, JSON.stringify(bounds));
  } catch (e) {
    // некритично, просто не запомним позицию на этот раз
  }
}

function clampToVisibleDisplay(state) {
  const displays = screen.getAllDisplays();
  const fitsAnyDisplay = displays.some((d) => {
    const a = d.workArea;
    return (
      state.x !== undefined &&
      state.x + 50 > a.x &&
      state.x < a.x + a.width - 50 &&
      state.y !== undefined &&
      state.y + 50 > a.y &&
      state.y < a.y + a.height - 50
    );
  });
  if (!fitsAnyDisplay) {
    delete state.x;
    delete state.y;
  }
  return state;
}

function setupApplicationMenu() {
  if (process.platform === 'darwin') {
    // На macOS без меню не работают системные Cmd+Q/Cmd+C/Cmd+V/Cmd+Z (в
    // отличие от Windows, где эти сочетания не завязаны на меню приложения) -
    // оставляем минимальный стандартный набор, просто без лишних пунктов.
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function createWindow() {
  const state = clampToVisibleDisplay(loadWindowState());

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: WINDOW_TITLE,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c10',
    webPreferences: {
      partition: 'persist:flatme-lk',
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Название окна держим постоянным - страница сама пытается выставить свой
  // <title> при каждой загрузке, отменяем это и подставляем наш.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE);
  });

  // Блокируем любые переходы за пределы спам-монитора - и обычные клики по
  // ссылкам (will-navigate), и серверные редиректы (will-redirect, например
  // после входа владельца сервер сам перенаправляет на "/").
  win.webContents.on('will-navigate', (event, url) => guardNavigation(event, url, win));
  win.webContents.on('will-redirect', (event, url) => guardNavigation(event, url, win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadURL(CABINET_URL);

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => saveWindowState(win));

  if (process.env.LK_SCREENSHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.LK_SCREENSHOT, image.toPNG());
        app.quit();
      }, 1200);
    });
  }

  return win;
}

app.whenReady().then(() => {
  setupApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
