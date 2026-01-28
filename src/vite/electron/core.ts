import type { StdioOptions, SpawnOptions } from 'node:child_process'
import type { Plugin, ConfigEnv, UserConfig, LibraryOptions, InlineConfig } from 'vite'

import { build as viteBuild, version } from 'vite'

import { resolveViteConfig, treeKillSync } from './utils'

export interface ElectronOptions {
  /**
   * Shortcut of `build.lib.entry`
   */
  entry?: LibraryOptions['entry']
  vite?: InlineConfig
  /**
   * Triggered when Vite is built every time -- `vite serve` command only.
   *
   * If this `onstart` is passed, Electron App will not start automatically.
   * However, you can start Electroo App via `startup` function.
   */
  onstart?: (args: {
    /**
     * Electron App startup function.
     * It will mount the Electron App child-process to `process.electronApp`.
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     */
    startup: (argv?: string[], options?: SpawnOptions, customElectronPkg?: string) => Promise<void>
    /** Reload Electron-Renderer */
    reload: () => void
  }) => void | Promise<void>
}

export function build(isESM: boolean, options: ElectronOptions): ReturnType<typeof viteBuild> {
  return viteBuild(resolveViteConfig(isESM, options))
}

export default function electron(
  isESM: boolean,
  options: ElectronOptions | ElectronOptions[],
): Plugin[] {
  const optionsArray = Array.isArray(options) ? options : [options]
  let userConfig: UserConfig
  let configEnv: ConfigEnv

  if (!version.startsWith('8.')) {
    throw new Error(
      `[vite-plugin-electron] Vite v${version} does not support \`rolldownOptions\`, please install \`vite@>=8\` or use an earlier version of \`vite-plugin-electron\`.`,
    )
  }

  async function parallelBuild(options: ElectronOptions[]) {
    await Promise.all(options.map(build.bind(build, isESM)))
  }

  return [
    {
      name: 'vite-plugin-electron:dev',
      apply: 'serve',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          Object.assign(process.env, {
            VITE_DEV_SERVER_URL: server.resolvedUrls?.local[0],
          })

          const entryCount = optionsArray.length
          let closeBundleCount = 0

          const result = optionsArray.map((options) => {
            options.vite ??= {}
            options.vite.mode ??= server.config.mode
            options.vite.root ??= server.config.root
            options.vite.envDir ??= server.config.envDir
            options.vite.envPrefix ??= server.config.envPrefix

            options.vite.build ??= {}
            if (!Object.keys(options.vite.build).includes('watch')) {
              // #252
              options.vite.build.watch = {}
            }
            options.vite.build.minify ??= false

            options.vite.plugins ??= []
            options.vite.plugins.push({
              name: ':startup',
              closeBundle() {
                if (++closeBundleCount < entryCount) {
                  return
                }

                if (options.onstart) {
                  options.onstart.call(this, {
                    startup,
                    // Why not use Vite's built-in `/@vite/client` to implement Hot reload?
                    // Because Vite only inserts `/@vite/client` into the `*.html` entry file, the preload scripts are usually a `*.js` file.
                    // @see - https://github.com/vitejs/vite/blob/v5.2.11/packages/vite/src/node/server/middlewares/indexHtml.ts#L399
                    reload() {
                      if (process.electronApp) {
                        ;(server.hot || server.ws).send({ type: 'full-reload' })

                        // For Electron apps that don't need to use the renderer process.
                        startup.send('electron-vite&type=hot-reload')
                      } else {
                        startup()
                      }
                    },
                  })
                } else {
                  startup()
                }
              },
            })
            return options
          })
          parallelBuild(result)
        })
      },
    },
    {
      name: 'vite-plugin-electron:prod',
      apply: 'build',
      config(config, env) {
        userConfig = config
        configEnv = env

        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging.
        config.base ??= './'
      },
      async closeBundle() {
        await parallelBuild(
          optionsArray.map((options) => {
            options.vite ??= {}
            options.vite.mode ??= configEnv.mode
            options.vite.root ??= userConfig.root
            options.vite.envDir ??= userConfig.envDir
            options.vite.envPrefix ??= userConfig.envPrefix
            return options
          }),
        )
      },
    },
  ]
}

interface StartupFn {
  (): Promise<void>
  send: (message: string) => void
  hookedProcessExit: boolean
  exit: () => Promise<void>
}

/**
 * Electron App startup function.
 * It will mount the Electron App child-process to `process.electronApp`.
 * @param argv default value `['.', '--no-sandbox']`
 * @param options options for `child_process.spawn`
 * @param customElectronPkg custom electron package name (default: 'electron')
 */
export const startup: StartupFn = async (
  argv = ['.', '--no-sandbox'],
  options?: SpawnOptions,
  customElectronPkg?: string,
) => {
  const { spawn } = await import('node:child_process')
  const electron = await import(customElectronPkg ?? 'electron')
  const electronPath = electron.default ?? electron

  await startup.exit()

  // Start Electron.app
  const stdio: StdioOptions =
    process.platform === 'linux'
      ? // reserve file descriptor 3 for Chromium; put Node IPC on file descriptor 4
        ['inherit', 'inherit', 'inherit', 'ignore', 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc']
  process.electronApp = spawn(electronPath, argv, {
    stdio,
    ...options,
  })

  // Exit command after Electron.app exits
  process.electronApp.once('exit', process.exit)

  if (!startup.hookedProcessExit) {
    startup.hookedProcessExit = true
    process.once('exit', startup.exit)
  }
}

startup.send = (message: string) => {
  if (process.electronApp) {
    // Based on { stdio: [,,, 'ipc'] }
    process.electronApp.send?.(message)
  }
}

startup.hookedProcessExit = false
startup.exit = async () => {
  if (process.electronApp) {
    await new Promise((resolve) => {
      process.electronApp.removeAllListeners()
      process.electronApp.once('exit', resolve)
      treeKillSync(process.electronApp.pid!)
    })
  }
}
