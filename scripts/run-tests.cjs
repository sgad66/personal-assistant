const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')

const root = process.cwd()
const buildDir = path.join(root, '.test-build')

function aliasTarget(request) {
  if (request.startsWith('@shared/')) {
    return path.join(buildDir, 'src', 'shared', request.slice('@shared/'.length))
  }
  if (request.startsWith('@main/')) {
    return path.join(buildDir, 'src', 'main', request.slice('@main/'.length))
  }
  if (request.startsWith('@renderer/')) {
    return path.join(buildDir, 'src', 'renderer', request.slice('@renderer/'.length))
  }
  return null
}

const originalResolve = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request === 'vitest') {
    return path.join(__dirname, 'vitest-shim.cjs')
  }
  const target = aliasTarget(request)
  if (target) {
    return originalResolve.call(this, target, parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

function collect(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collect(full))
    } else if (entry.isFile() && full.endsWith('.spec.js')) {
      files.push(full)
    }
  }
  return files
}

const shim = require('./vitest-shim.cjs')
const specFiles = collect(path.join(buildDir, 'tests'))
if (specFiles.length === 0) {
  console.error('未找到已编译的测试文件，请先运行 tsc -p tsconfig.test.json')
  process.exit(1)
}

for (const file of specFiles) {
  require(file)
}

shim
  .run()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })