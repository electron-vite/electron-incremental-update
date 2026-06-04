declare namespace NodeJS {
  interface Process {
    electronApp: import('node:child_process').ChildProcess
    cachedElectronOptions?: import('vite-plugin-electron/multi-env').MultiEnvElectronOptions[]
    __electron_path: string | undefined
    __bytecode_compiler_path: string | undefined
  }
}
