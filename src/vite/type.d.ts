declare namespace NodeJS {
  interface Process {
    electronApp: import('node:child_process').ChildProcess
    cachedOptions: import('./types').ResolvedOptions
    __electron_path: string | undefined
    __bytecode_compiler_path: string | undefined
  }
}
