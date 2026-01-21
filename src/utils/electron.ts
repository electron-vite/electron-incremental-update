import { BrowserWindow } from 'electron'

import fs from 'node:fs'
import path from 'node:path'

import electron, { app } from 'electron'

/**
 * type only entry dir path, transformed by vite's define
 */
declare const __EIU_ENTRY_DIST_PATH__: string
/**
 * type only electron dist path, transformed by vite's define
 */
declare const __EIU_ELECTRON_DIST_PATH__: string
/**
 * type only is dev, transformed by vite's define
 */
declare const __EIU_IS_DEV__: boolean
/**
 * type only is esmodule, transformed by vite's define
 */
declare const __EIU_IS_ESM__: boolean

/**
 * Compile time dev check
 */
export const isDev: boolean = __EIU_IS_DEV__

export const isWin: boolean = process.platform === 'win32'

export const isMac: boolean = process.platform === 'darwin'

export const isLinux: boolean = process.platform === 'linux'

/**
 * Get joined path of `${electron.app.name}.asar` (not `app.asar`)
 *
 * If is in dev, **always** return `'DEV.asar'`
 */
export function getPathFromAppNameAsar(...paths: string[]): string {
  return isDev ? 'DEV.asar' : path.join(path.dirname(app.getAppPath()), `${app.name}.asar`, ...paths)
}

/**
 * Get app version, if is in dev, return `getEntryVersion()`
 */
export function getAppVersion(): string {
  return isDev ? getEntryVersion() : fs.readFileSync(getPathFromAppNameAsar('version'), 'utf-8')
}

/**
 * Get entry version
 */
export function getEntryVersion(): string {
  return app.getVersion()
}

/**
 * Use `require` to load native module from entry asar
 * @param moduleName file name in entry
 * @example
 * requireNative<typeof import('../native/db')>('db')
 */
export function requireNative<T = any>(moduleName: string): T {
  const m = getPathFromEntryAsar(moduleName)
  if (__EIU_IS_ESM__) {
    throw new Error(`Cannot require "${m}", \`requireNative\` only support CommonJS, use \`importNative\` instead`)
  }
  // eslint-disable-next-line ts/no-require-imports
  return require(m)
}

/**
 * Use `import` to load native module from entry asar
 * @param moduleName file name in entry
 * @example
 * await importNative<typeof import('../native/db')>('db')
 */
export async function importNative<T = any>(moduleName: string): Promise<T> {
  const m = getPathFromEntryAsar(moduleName)
  if (!__EIU_IS_ESM__) {
    throw new Error(`Cannot import "${m}", \`importNative\` only support ESModule, use \`requireNative\` instead`)
  }
  return await import(`file://${m}.js`)
}

/**
 * Restarts the Electron app.
 */
export function restartApp(): void {
  app.relaunch()
  app.quit()
}

/**
 * Fix app use model id, only for Windows
 * @param id app id, default is `org.${electron.app.name}`
 */
export function setAppUserModelId(id?: string): void {
  if (isWin) {
    app.setAppUserModelId(id ?? `org.${app.name}`)
  }
}

/**
 * Disable hardware acceleration for Windows 7
 *
 * Only support CommonJS
 */
export function disableHWAccForWin7(): void {
  // eslint-disable-next-line ts/no-require-imports
  if (!__EIU_IS_ESM__ && require('node:os').release().startsWith('6.1')) {
    app.disableHardwareAcceleration()
  }
}

/**
 * Keep single electron instance and auto restore window on `second-instance` event
 * @param window brwoser window to show
 */
export function singleInstance(window?: BrowserWindow): void {
  app.on('second-instance', () => {
    if (window) {
      window.show()
      if (window.isMinimized()) {
        window.restore()
      }
      window.focus()
    }
  })
}

/**
 * Set `userData` dir to the dir of .exe file
 *
 * Useful for portable Windows app
 * @param dirName dir name, default to `data`
 * @param create whether to create dir, default to `true`
 */
export function setPortableDataPath(dirName: string = 'data', create: boolean = true): void {
  if (app.isReady()) {
    throw new Error('Portable app data dir must be setup before app is ready')
  }

  const portableDir = path.join(path.dirname(app.getPath('exe')), dirName)

  if (create) {
    if (!fs.existsSync(portableDir)) {
      fs.mkdirSync(portableDir)
    } else if (!fs.statSync(portableDir).isDirectory()) {
      fs.rmSync(portableDir)
      fs.mkdirSync(portableDir)
    }
  } else if (!fs.existsSync(portableDir)) {
    throw new Error('Portable app data dir does not exists')
  }

  app.setPath('userData', portableDir)
}

/**
 * @deprecated Use {@link setPortableDataPath} instead
 */
export const setPortableAppDataPath: typeof setPortableDataPath = setPortableDataPath

/**
 * Load `process.env.VITE_DEV_SERVER_URL` when dev, else load html file
 * @param win window
 * @param htmlFilePath html file path, default is `index.html`
 */
export function loadPage(win: BrowserWindow, htmlFilePath = 'index.html'): void {
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL! + htmlFilePath)
  } else {
    win.loadFile(getPathFromAppNameAsar('renderer', htmlFilePath))
  }
}

declare const __FONT_CSS__: string
declare const __SCROLLBAR_CSS__: string
declare const __JS__: string

interface BeautifyDevToolsOptions {
  /**
   * Sans-serif font family
   */
  sans: string
  /**
   * Monospace font family
   */
  mono: string
  /**
   * Whether to round scrollbar
   */
  scrollbar?: boolean
}

/**
 * Beautify devtools' font and scrollbar
 * @param win target window
 * @param options sans font family, mono font family and scrollbar
 * @see https://github.com/electron/electron/issues/42055
 */
export function beautifyDevTools(win: BrowserWindow, options: BeautifyDevToolsOptions): void {
  const { mono, sans, scrollbar = true } = options
  win.webContents.on('devtools-opened', async () => {
    // eslint-disable-next-line prefer-template
    let css = `:root{--sans:${sans};--mono:${mono}}` + __FONT_CSS__
    if (scrollbar) {
      css += __SCROLLBAR_CSS__
    }
    const js = `const __CSS__='${css}';${__JS__}`
    await win?.webContents.devToolsWebContents?.executeJavaScript(js)
  })
}
/**
 * Get joined path from main dir
 * @param paths rest paths
 */
export function getPathFromMain(...paths: string[]): string {
  return isDev
    ? path.join(app.getAppPath(), __EIU_ELECTRON_DIST_PATH__, 'main', ...paths)
    : getPathFromAppNameAsar('main', ...paths)
}
/**
 * Get joined path from preload dir
 * @param paths rest paths
 */
export function getPathFromPreload(...paths: string[]): string {
  return isDev
    ? path.join(app.getAppPath(), __EIU_ELECTRON_DIST_PATH__, 'preload', ...paths)
    : getPathFromAppNameAsar('preload', ...paths)
}

/**
 * Get joined path from publich dir
 * @param paths rest paths
 */
export function getPathFromPublic(...paths: string[]): string {
  return isDev
    ? path.join(app.getAppPath(), 'public', ...paths)
    : getPathFromAppNameAsar('renderer', ...paths)
}

/**
 * Get joined path from entry asar
 * @param paths rest paths
 */
export function getPathFromEntryAsar(...paths: string[]): string {
  return path.join(app.getAppPath(), __EIU_ENTRY_DIST_PATH__, ...paths)
}

/**
 * Handle all unhandled error
 * @param callback callback function
 */
export function handleUnexpectedErrors(callback: (err: unknown) => void): void {
  process.on('uncaughtException', callback)
  process.on('unhandledRejection', callback)
}

export function reloadOnPreloadScriptChanged(): void {
  if (isDev) {
    process.on('message', (msg) => {
      if (msg === 'electron-vite&type=hot-reload') {
        for (const window of BrowserWindow.getAllWindows()) {
          window.reload()
        }
      }
    })
  }
}
