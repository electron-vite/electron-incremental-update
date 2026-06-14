declare namespace NodeJS {
  interface Process {
    electronApp: import('node:child_process').ChildProcess
    CACHED_ELECTRON_OPTIONS?: Promise<
      import('vite-plugin-electron/multi-env').MultiEnvElectronOptions[]
    >
    CACHED_ELECTRON_PATH: string | undefined
    CACHED_BYTECODE_COMPILER_PATH: string | undefined
  }
}
