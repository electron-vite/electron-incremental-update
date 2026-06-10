export const bytecodeGeneratorScript =
  "const vm = require('vm')\n" +
  "const v8 = require('v8')\n" +
  "const wrap = require('module').wrap\n" +
  "v8.setFlagsFromString('--no-lazy')\n" +
  "v8.setFlagsFromString('--no-flush-bytecode')\n" +
  "let code = ''\n" +
  "process.stdin.setEncoding('utf-8')\n" +
  "process.stdin.on('readable', () => {\n" +
  '  const data = process.stdin.read()\n' +
  '  if (data !== null) {\n' +
  '    code += data\n' +
  '  }\n' +
  '})\n' +
  "process.stdin.on('end', () => {\n" +
  '  try {\n' +
  "    if (typeof code !== 'string') {\n" +
  "      throw new Error('javascript code must be string.')\n" +
  '    }\n' +
  '    const script = new vm.Script(wrap(code), { produceCachedData: true })\n' +
  '    const bytecodeBuffer = script.createCachedData()\n' +
  '    process.stdout.write(bytecodeBuffer)\n' +
  '  } catch (error) {\n' +
  '    console.error(error)\n' +
  '  }\n' +
  '})\n'

export const bytecodeModuleLoaderCode =
  '"use strict";\n' +
  'const fs = require("fs");\n' +
  'const path = require("path");\n' +
  'const vm = require("vm");\n' +
  'const v8 = require("v8");\n' +
  'const Module = require("module");\n' +
  'v8.setFlagsFromString("--no-lazy");\n' +
  'v8.setFlagsFromString("--no-flush-bytecode");\n' +
  'const FLAG_HASH_OFFSET = 12;\n' +
  'const SOURCE_HASH_OFFSET = 8;\n' +
  'let dummyBytecode;\n' +
  'function setFlagHashHeader(bytecodeBuffer) {\n' +
  '  if (!dummyBytecode) {\n' +
  '    const script = new vm.Script("", {\n' +
  '      produceCachedData: true\n' +
  '    });\n' +
  '    dummyBytecode = script.createCachedData();\n' +
  '  }\n' +
  '  dummyBytecode.slice(FLAG_HASH_OFFSET, FLAG_HASH_OFFSET + 4).copy(bytecodeBuffer, FLAG_HASH_OFFSET);\n' +
  '};\n' +
  'function getSourceHashHeader(bytecodeBuffer) {\n' +
  '  return bytecodeBuffer.slice(SOURCE_HASH_OFFSET, SOURCE_HASH_OFFSET + 4);\n' +
  '};\n' +
  'function buffer2Number(buffer) {\n' +
  '  let ret = 0;\n' +
  '  ret |= buffer[3] << 24;\n' +
  '  ret |= buffer[2] << 16;\n' +
  '  ret |= buffer[1] << 8;\n' +
  '  ret |= buffer[0];\n' +
  '  return ret;\n' +
  '};\n' +
  'Module._extensions[".jsc"] = Module._extensions[".cjsc"] = function (module, filename) {\n' +
  '  const bytecodeBuffer = fs.readFileSync(filename);\n' +
  '  if (!Buffer.isBuffer(bytecodeBuffer)) {\n' +
  '    throw new Error("BytecodeBuffer must be a buffer object.");\n' +
  '  }\n' +
  '  setFlagHashHeader(bytecodeBuffer);\n' +
  '  const length = buffer2Number(getSourceHashHeader(bytecodeBuffer));\n' +
  '  let dummyCode = "";\n' +
  '  if (length > 1) {\n' +
  '    dummyCode = "\\"" + "\\u200b".repeat(length - 2) + "\\"";\n' +
  '  }\n' +
  '  const script = new vm.Script(dummyCode, {\n' +
  '    filename: filename,\n' +
  '    lineOffset: 0,\n' +
  '    displayErrors: true,\n' +
  '    cachedData: bytecodeBuffer\n' +
  '  });\n' +
  '  if (script.cachedDataRejected) {\n' +
  '    throw new Error("Invalid or incompatible cached data (cachedDataRejected)");\n' +
  '  }\n' +
  '  const require = function (id) {\n' +
  '    return module.require(id);\n' +
  '  };\n' +
  '  require.resolve = function (request, options) {\n' +
  '    return Module._resolveFilename(request, module, false, options);\n' +
  '  };\n' +
  '  if (process.mainModule) {\n' +
  '    require.main = process.mainModule;\n' +
  '  }\n' +
  '  require.extensions = Module._extensions;\n' +
  '  require.cache = Module._cache;\n' +
  '  const compiledWrapper = script.runInThisContext({\n' +
  '    filename: filename,\n' +
  '    lineOffset: 0,\n' +
  '    columnOffset: 0,\n' +
  '    displayErrors: true\n' +
  '  });\n' +
  '  const dirname = path.dirname(filename);\n' +
  '  const args = [module.exports, require, module, filename, dirname, process, global];\n' +
  '  return compiledWrapper.apply(module.exports, args);\n' +
  '};\n'
