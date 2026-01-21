console.log('DEPRECATED')
const { writeFileSync, mkdirSync } = require('node:fs')
const { relative, join } = require('node:path/posix')

const { exports: exp } = require('./package.json')

console.log('fix cjs')
generate(exp, __dirname)
console.log('fix finish')
function generate(exportMap, ROOT_PATH) {
  for (const ex of Object.keys(exportMap)) {
    if (ex === '.' || exportMap[ex].require === undefined) {
      continue
    }

    const [, ...folders] = ex.split('/')
    const fileName = folders.pop()

    const [, ...targetFolders] = exportMap[ex].require.split('/')
    const targetFileName = targetFolders.pop()
    const target = relative(
      join(ROOT_PATH, ...folders),
      join(ROOT_PATH, ...targetFolders, targetFileName),
    )

    mkdirSync(join(ROOT_PATH, ...folders), {
      recursive: true,
    })

    writeFileSync(
      join(ROOT_PATH, ...folders, `${fileName}.js`),
      `module.exports = require('./${target}')`,
    )

    writeFileSync(
      join(ROOT_PATH, ...folders, `${fileName}.d.ts`),
      `export * from './${target.split('.')[0]}'`,
    )
  }
}
// console.log('type check start')
// typecheck()
// console.log('type check finish')

// function typecheck() {
// https://github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/packages/cli
// try {
//   execSync('attw -h')
// } catch (e) {
//   console.log('no attw, skip type check, run `npm i -g @arethetypeswrong/cli` to enable')
//   return
// }
// const path = `${name}-${version}.tgz`
// execSync('npm pack')
// try {
//   const result = execSync(`attw ${path}`, { encoding: 'utf-8' }).toString('utf-8')
//   console.log(result)
// } catch (_e) {
//   throw new Error('type check fail')
// } finally {
//   rmSync(path)
// }
// }
