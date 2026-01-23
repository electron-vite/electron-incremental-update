import { defineElectronConfig } from "../src/vite";

export default defineElectronConfig({
  // todo)) pkg can be a path to package.json
  // pkg: {
  //   main: './dist-entry/entry.js',
  //   name: 'test',
  //   type: 'commonjs',
  //   version: '0.0.1'
  // },
  main: { files: './main.ts' },
  updater: {
    entry: {
      appEntryPath: './entry.ts'
    },
  },
  // todo)) new `root` in top level. create package.json if not exist
  renderer: {

  }
})