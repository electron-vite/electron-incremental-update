declare namespace NodeJS {
  interface Process {
    electronApp: import('node:child_process').ChildProcess
  }
}
