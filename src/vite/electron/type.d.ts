declare namespace NodeJS {
  import type { ChildProcess } from 'node:child_process'
  interface Process {
    electronApp: ChildProcess
  }
}
