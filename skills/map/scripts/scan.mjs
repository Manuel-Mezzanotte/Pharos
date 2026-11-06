#!/usr/bin/env node
// Lo scanner di Pharos: elenca i file di un progetto, ne conta le righe e trova
// quale file importa quale. Lo usa render.mjs; da solo stampa una panoramica
// breve del progetto, che Claude legge prima di disegnare la mappa.
//
//   node scan.mjs [cartella-del-progetto] [--files <sottocartella>] [--json]

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { basename, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_FILES = 25_000
const MAX_BYTES = 1_500_000

// Cartelle che non sono codice del progetto: dipendenze, risultati di build, cache.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo',
  '.cache', 'coverage', 'target', 'vendor', 'venv', '.venv', 'env', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.idea', '.vscode', '.pharos', '.atlas', '.gradle', 'Pods', 'DerivedData', '.dart_tool',
  'bower_components', '.parcel-cache', '.angular', '.expo', '.yarn', '.pnpm-store', '.output',
])

const LANGUAGE = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.scala': 'Scala', '.dart': 'Dart',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.m': 'Objective-C', '.mm': 'Objective-C',
  '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS', '.html': 'HTML', '.htm': 'HTML',
  '.sql': 'SQL', '.prisma': 'Prisma', '.graphql': 'GraphQL', '.gql': 'GraphQL', '.proto': 'Protobuf',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.ps1': 'PowerShell', '.lua': 'Lua',
  '.ex': 'Elixir', '.exs': 'Elixir', '.md': 'Markdown', '.mdx': 'Markdown', '.yml': 'YAML',
  '.yaml': 'YAML', '.toml': 'TOML', '.tf': 'Terraform', '.json': 'JSON',
}

// Quale lettore di import usare per ogni estensione.
const READER = {
  '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.vue': 'js', '.svelte': 'js', '.astro': 'js',
  '.css': 'css', '.scss': 'css', '.sass': 'css', '.less': 'css',
  '.py': 'py', '.go': 'go', '.rs': 'rs', '.java': 'java', '.kt': 'java', '.kts': 'java',
  '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.cxx': 'c', '.hpp': 'c', '.hh': 'c', '.m': 'c', '.mm': 'c',
  '.dart': 'dart',
}

const NAMED = { Dockerfile: 'Docker', Makefile: 'Make', Procfile: 'Config', 'go.mod': 'Go' }
const JSON_CONFIG = /^(package|tsconfig[\w.-]*|jsconfig|composer|deno|turbo|nx|vercel|firebase|angular|lerna|biome|app|manifest)\.json$/

const JS_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro', '.json', '.css', '.scss']
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }
const BUILTINS = new Set(builtinModules.map(name => name.split('/')[0]))

const PY_STDLIB = new Set(
  ('__future__ abc argparse array ast asyncio atexit base64 bisect builtins calendar cgi codecs collections ' +
    'colorsys concurrent configparser contextlib copy csv ctypes dataclasses datetime decimal difflib dis ' +
    'email enum errno faulthandler fnmatch fractions ftplib functools gc getopt getpass gettext glob gzip ' +
    'hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache ' +
    'locale logging lzma math mimetypes multiprocessing numbers operator os pathlib pdb pickle pkgutil ' +
    'platform plistlib pprint profile queue random re readline reprlib resource runpy sched secrets select ' +
    'selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics ' +
    'string struct subprocess sys sysconfig tarfile tempfile textwrap threading time timeit tkinter token ' +
    'tokenize trace traceback tracemalloc turtle types typing unicodedata unittest urllib uuid venv warnings ' +
    'wave weakref webbrowser xml xmlrpc zipapp zipfile zlib zoneinfo').split(' '),
)

// ---------------------------------------------------------------- elenco dei file

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const list = out.split('\0').filter(Boolean)
    if (list.length > 0) return list
  } catch {
    // niente git: si cammina nelle cartelle
  }

  return walk(root)
}

function walk(root) {
  const out = []
  const visit = (dir, prefix) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length > MAX_FILES * 2) return
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue
        visit(join(dir, entry.name), path)
      } else if (entry.isFile()) {
        out.push(path)
      }
    }
  }
  visit(root, '')

  return out
}

function classify(path) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name.startsWith('.') || name === 'pnpm-lock.yaml' || /\.min\.(js|css)$/.test(name)) return undefined
  if (NAMED[name] !== undefined) return { ext: '', language: NAMED[name] }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  const language = LANGUAGE[ext]
  if (language === undefined) return undefined
  if (ext === '.json' && !JSON_CONFIG.test(name)) return undefined

  return { ext, language }
}

// ---------------------------------------------------------------- JSON con commenti

export function parseJsonc(text) {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === '"') inString = false
      i += 1
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i += 1
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
    } else {
      out += c
      i += 1
    }
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function readJson(root, path) {
  try {
    return parseJsonc(readFileSync(join(root, path), 'utf8'))
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- cosa importa cosa

function findJs(base, set) {
  const path = posix.normalize(base).replace(/^\.\//, '')
  if (set.has(path)) return path
  const swap = /\.(?:[cm]?js|jsx)$/.exec(path)
  if (swap !== null) {
    const stem = path.slice(0, -swap[0].length)
    for (const ext of JS_TO_TS[swap[0]] ?? []) if (set.has(stem + ext)) return stem + ext
  }
  for (const ext of JS_EXTS) if (set.has(path + ext)) return path + ext
  for (const ext of JS_EXTS) if (set.has(`${path}/index${ext}`)) return `${path}/index${ext}`

  return undefined
}

function pkgName(spec) {
  return /^(@[\w.-]+\/[\w.-]+|[\w.-]+)/.exec(spec)?.[1]
}

function jsSpecs(text) {
  const specs = []
  const statement = /^[ \t]*(?:import|export)\b(?:[^'"`;]{0,2000}?\bfrom\b)?\s*['"]([^'"\n]+)['"]/gm
  const call = /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
  for (const match of text.matchAll(statement)) specs.push(match[1])
  for (const match of text.matchAll(call)) specs.push(match[1])

  return specs
}

// Gli alias di tsconfig/jsconfig (@/*, ~/*, baseUrl), anche con "extends".
function loadAliases(root, files) {
  const configs = files.filter(path => /(^|\/)(tsconfig[\w.-]*|jsconfig)\.json$/.test(path))
  const byDir = new Map()

  const effective = (path, depth = 0) => {
    const config = readJson(root, path)
    if (config === undefined) return {}
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    let merged = {}
    if (typeof config.extends === 'string' && config.extends.startsWith('.') && depth < 3) {
      const parent = posix.join(dir, config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`)
      merged = effective(parent, depth + 1)
    }
    const options = config.compilerOptions ?? {}
    if (typeof options.baseUrl === 'string') merged.baseUrl = posix.join(dir, options.baseUrl)
    if (options.paths !== undefined && typeof options.paths === 'object') {
      merged.paths = options.paths
      merged.pathsDir = dir
    }

    return merged
  }

  for (const path of configs) {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    const config = effective(path)
    const entry = byDir.get(dir) ?? { baseUrl: undefined, rules: [] }
    if (config.baseUrl !== undefined) entry.baseUrl = config.baseUrl
    for (const [pattern, targets] of Object.entries(config.paths ?? {})) {
      if (!Array.isArray(targets)) continue
      const star = pattern.indexOf('*')
      entry.rules.push({
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? '' : pattern.slice(star + 1),
        isWild: star !== -1,
        targets: targets.map(target => posix.join(config.baseUrl ?? config.pathsDir ?? dir, String(target))),
      })
    }
    byDir.set(dir, entry)
  }

  const cache = new Map()

  // La configurazione più vicina al file, risalendo le cartelle.
  return from => {
    let dir = posix.dirname(from) === '.' ? '' : posix.dirname(from)
    const start = dir
    if (cache.has(start)) return cache.get(start)
    let found
    for (;;) {
      const entry = byDir.get(dir)
      if (entry !== undefined && (entry.rules.length > 0 || entry.baseUrl !== undefined)) {
        found = entry
        break
      }
      if (dir === '') break
      dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir)
    }
    cache.set(start, found)

    return found
  }
}

// I pacchetti del progetto stesso (monorepo): nome -> cartella.
function loadWorkspaces(root, files) {
  const packages = new Map()
  const manifests = new Map()
  for (const path of files.filter(one => one === 'package.json' || one.endsWith('/package.json'))) {
    const json = readJson(root, path)
    if (typeof json?.name !== 'string') continue
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    packages.set(json.name, dir)
    manifests.set(dir, json)
  }

  return { packages, manifests }
}

function entryOf(json) {
  const dot = json.exports?.['.'] ?? json.exports
  const fromExports = typeof dot === 'string' ? dot : (dot?.import ?? dot?.default ?? dot?.types)

  return [json.source, typeof json.module === 'string' ? json.module : undefined, json.main, fromExports].filter(
    one => typeof one === 'string',
  )
}

function resolveJs(spec, from, ctx) {
  if (spec.startsWith('.')) {
    const hit = findJs(posix.join(posix.dirname(from), spec), ctx.set)

    return hit === undefined ? undefined : { file: hit }
  }
  if (spec.startsWith('/') || spec.startsWith('#')) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !/^(npm|jsr):/.test(spec)) return undefined
  const bare = spec.replace(/^(npm|jsr):/, '')

  const aliases = ctx.aliases(from)
  if (aliases !== undefined) {
    let isMatched = false
    for (const rule of aliases.rules) {
      const isHit = rule.isWild
        ? bare.startsWith(rule.prefix) && bare.endsWith(rule.suffix) && bare.length >= rule.prefix.length + rule.suffix.length
        : bare === rule.prefix
      if (!isHit) continue
      isMatched = true
      const middle = rule.isWild ? bare.slice(rule.prefix.length, bare.length - rule.suffix.length) : ''
      for (const target of rule.targets) {
        const hit = findJs(rule.isWild ? target.replace('*', middle) : target, ctx.set)
        if (hit !== undefined) return { file: hit }
      }
    }
    if (isMatched) return undefined
    if (aliases.baseUrl !== undefined) {
      const hit = findJs(posix.join(aliases.baseUrl, bare), ctx.set)
      if (hit !== undefined) return { file: hit }
    }
  }

  const name = pkgName(bare)
  if (name === undefined) return undefined
  const dir = ctx.packages.get(name)
  if (dir !== undefined) {
    const sub = bare.slice(name.length).replace(/^\//, '')
    const json = ctx.manifests.get(dir) ?? {}
    const tries =
      sub === ''
        ? [...entryOf(json).map(entry => join_(dir, entry)), join_(dir, 'src/index'), join_(dir, 'index')]
        : [join_(dir, sub), join_(dir, `src/${sub}`), join_(dir, `lib/${sub}`)]
    for (const attempt of tries) {
      const hit = findJs(attempt, ctx.set)
      if (hit !== undefined) return { file: hit }
    }

    return undefined
  }
  if (BUILTINS.has(name)) return undefined

  return { external: name }
}

function join_(dir, rest) {
  return dir === '' ? posix.normalize(rest) : posix.join(dir, rest)
}

function cssSpecs(text) {
  return [...text.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"\n]+)['"]/g)].map(match => match[1])
}

function resolveCss(spec, from, ctx) {
  if (/^(https?:)?\/\//.test(spec)) return undefined
  const base = posix.join(posix.dirname(from), spec)
  const dir = posix.dirname(base)
  const stem = posix.basename(base)
  for (const candidate of [base, `${base}.css`, `${base}.scss`, `${dir}/_${stem}.scss`, `${dir}/_${stem}`, `${base}/index.scss`, `${base}/_index.scss`]) {
    if (ctx.set.has(candidate)) return { file: candidate }
  }
  if (!spec.startsWith('.') && !spec.startsWith('~') && !spec.startsWith('/')) {
    const name = pkgName(spec)
    if (name !== undefined && !name.startsWith('sass:')) return { external: name }
  }

  return undefined
}

function pySpecs(text) {
  const out = []
  for (const match of text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([^\n]+)/gm)) {
    const names = match[3].replace(/#.*$/, '').replace(/[()]/g, '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
    out.push({ dots: match[1].length, mod: match[2], names })
  }
  for (const match of text.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) {
    for (const part of match[1].split(',')) {
      const mod = part.trim().split(/\s+/)[0]
      if (/^[\w.]+$/.test(mod)) out.push({ dots: 0, mod, names: [] })
    }
  }

  return out
}

function resolvePy(spec, from, ctx) {
  const { dots, mod, names } = spec
  const dir = posix.dirname(from) === '.' ? '' : posix.dirname(from)
  const found = []
  const bases = []
  if (dots > 0) {
    let up = dir
    for (let i = 1; i < dots; i += 1) up = posix.dirname(up) === '.' ? '' : posix.dirname(up)
    bases.push(up)
  } else {
    let up = dir
    for (;;) {
      bases.push(up)
      if (up === '') break
      up = posix.dirname(up) === '.' ? '' : posix.dirname(up)
    }
  }
  const modPath = mod.split('.').filter(Boolean).join('/')
  for (const base of bases) {
    const path = join_(base, modPath)
    let own
    if (modPath !== '') {
      if (ctx.set.has(`${path}.py`)) own = `${path}.py`
      else if (ctx.set.has(`${path}/__init__.py`)) own = `${path}/__init__.py`
    } else if (ctx.set.has(join_(base, '__init__.py'))) {
      own = join_(base, '__init__.py')
    }
    // "from pkg import name": se name è un sottomodulo il collegamento va a lui;
    // se è qualcosa definito in __init__.py, va a __init__.py.
    const subs = []
    for (const name of names) {
      const sub = join_(path, name)
      if (ctx.set.has(`${sub}.py`)) subs.push(`${sub}.py`)
      else if (ctx.set.has(`${sub}/__init__.py`)) subs.push(`${sub}/__init__.py`)
    }
    found.push(...(subs.length > 0 ? subs : own !== undefined ? [own] : []))
    if (found.length > 0) return { files: found }
  }
  if (dots === 0) {
    const top = mod.split('.')[0]
    if (top !== '' && !PY_STDLIB.has(top)) return { external: top }
  }

  return undefined
}

function goSpecs(text) {
  const out = []
  for (const block of text.matchAll(/^[ \t]*import[ \t]*\(([\s\S]*?)\)/gm)) {
    for (const line of block[1].matchAll(/^[ \t]*(?:[\w.]+[ \t]+)?"([^"]+)"/gm)) out.push(line[1])
  }
  for (const one of text.matchAll(/^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?"([^"]+)"/gm)) out.push(one[1])

  return out
}

function loadGo(root, files) {
  const modules = []
  for (const path of files.filter(one => one === 'go.mod' || one.endsWith('/go.mod'))) {
    try {
      const name = /^module\s+(\S+)/m.exec(readFileSync(join(root, path), 'utf8'))?.[1]
      if (name !== undefined) modules.push({ name, dir: posix.dirname(path) === '.' ? '' : posix.dirname(path) })
    } catch {
      // un go.mod che non si legge si salta
    }
  }
  const byDir = new Map()
  for (const path of files.filter(one => one.endsWith('.go') && !one.endsWith('_test.go'))) {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    if (!byDir.has(dir)) byDir.set(dir, path)
  }

  return { modules: modules.sort((a, b) => b.name.length - a.name.length), byDir }
}

function resolveGo(spec, ctx) {
  for (const mod of ctx.go.modules) {
    if (spec === mod.name || spec.startsWith(`${mod.name}/`)) {
      const dir = join_(mod.dir, spec.slice(mod.name.length).replace(/^\//, ''))
      const file = ctx.go.byDir.get(dir === '.' ? '' : dir)

      return file === undefined ? undefined : { file }
    }
  }
  const parts = spec.split('/')
  if (!parts[0].includes('.')) return undefined

  return { external: parts.slice(0, 3).join('/') }
}

function rsSpecs(text) {
  const out = []
  for (const match of text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm)) out.push({ mod: match[1] })
  for (const match of text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/gm)) {
    const path = match[1].split(/[{*]/)[0].replace(/\s+/g, '').replace(/::$/, '')
    if (path !== '') out.push({ use: path.split('::') })
  }

  return out
}

function loadRust(root, files) {
  const crates = new Map()
  for (const path of files.filter(one => one === 'Cargo.toml' || one.endsWith('/Cargo.toml'))) {
    try {
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, path), 'utf8'))?.[1]
      const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
      if (name !== undefined) crates.set(name.replace(/-/g, '_'), join_(dir, 'src'))
    } catch {
      // un Cargo.toml che non si legge si salta
    }
  }

  return crates
}

function rsModuleDir(from) {
  const name = posix.basename(from)
  const dir = posix.dirname(from)
  if (name === 'mod.rs' || name === 'lib.rs' || name === 'main.rs') return dir

  return join_(dir, name.replace(/\.rs$/, ''))
}

function rsFind(dir, segments, set) {
  for (let k = segments.length; k >= 1; k -= 1) {
    const base = join_(dir, segments.slice(0, k).join('/'))
    if (set.has(`${base}.rs`)) return `${base}.rs`
    if (set.has(`${base}/mod.rs`)) return `${base}/mod.rs`
  }

  return undefined
}

function resolveRs(spec, from, ctx) {
  if (spec.mod !== undefined) {
    const hit = rsFind(rsModuleDir(from), [spec.mod], ctx.set)

    return hit === undefined ? undefined : { file: hit }
  }
  const [head, ...rest] = spec.use
  const crateRoot = ctx.rustCrates.get(head)
  let dir
  let segments = rest
  if (head === 'crate') {
    let up = posix.dirname(from)
    while (up !== '.' && !ctx.set.has(join_(up, 'lib.rs')) && !ctx.set.has(join_(up, 'main.rs'))) up = posix.dirname(up)
    dir = up === '.' ? '' : up
  } else if (head === 'self') {
    dir = rsModuleDir(from)
  } else if (head === 'super') {
    dir = posix.dirname(rsModuleDir(from))
  } else if (crateRoot !== undefined) {
    dir = crateRoot
  } else if (['std', 'core', 'alloc'].includes(head)) {
    return undefined
  } else {
    // un modulo vicino al file, altrimenti una dipendenza esterna
    const near = rsFind(rsModuleDir(from), spec.use, ctx.set) ?? rsFind(posix.dirname(from), spec.use, ctx.set)

    return near !== undefined ? { file: near } : { external: head }
  }
  while (segments[0] === 'super') {
    dir = posix.dirname(dir)
    segments = segments.slice(1)
  }
  const hit = rsFind(dir, segments, ctx.set)

  return hit === undefined ? undefined : { file: hit }
}

function loadJava(root, files, texts) {
  const index = new Map()
  const packages = new Map()
  for (const path of files.filter(one => /\.(java|kt|kts)$/.test(one))) {
    const text = texts.get(path)
    const pkg = text === undefined ? undefined : /^[ \t]*package[ \t]+([\w.]+)/m.exec(text)?.[1]
    if (pkg === undefined) continue
    const name = posix.basename(path).replace(/\.\w+$/, '')
    index.set(`${pkg}.${name}`, path)
    if (!packages.has(pkg)) packages.set(pkg, path)
  }

  return { index, packages }
}

function resolveJava(spec, ctx) {
  const isWild = spec.endsWith('.*')
  let name = isWild ? spec.slice(0, -2) : spec
  if (isWild) {
    const file = ctx.java.packages.get(name)
    if (file !== undefined) return { file }
  } else {
    for (;;) {
      const file = ctx.java.index.get(name)
      if (file !== undefined) return { file }
      if (!name.includes('.')) break
      name = name.slice(0, name.lastIndexOf('.'))
    }
  }
  if (/^(java|javax|jdk|sun|kotlin)\./.test(spec)) return undefined

  return { external: spec.split('.').slice(0, 2).join('.') }
}

function resolveC(spec, from, ctx) {
  const tries = [
    join_(posix.dirname(from) === '.' ? '' : posix.dirname(from), spec),
    posix.normalize(spec),
    join_('include', spec),
    join_('src', spec),
  ]
  for (const attempt of tries) if (ctx.set.has(attempt)) return { file: attempt }
  const same = ctx.byBase.get(posix.basename(spec))
  if (same !== undefined && same.length === 1) return { file: same[0] }

  return undefined
}

function loadDart(root, files) {
  const packages = new Map()
  for (const path of files.filter(one => one === 'pubspec.yaml' || one.endsWith('/pubspec.yaml'))) {
    try {
      const name = /^name:\s*(\S+)/m.exec(readFileSync(join(root, path), 'utf8'))?.[1]
      if (name !== undefined) packages.set(name, posix.dirname(path) === '.' ? '' : posix.dirname(path))
    } catch {
      // un pubspec che non si legge si salta
    }
  }

  return packages
}

function resolveDart(spec, from, ctx) {
  if (spec.startsWith('dart:')) return undefined
  if (spec.startsWith('package:')) {
    const [name, ...rest] = spec.slice('package:'.length).split('/')
    const dir = ctx.dartPackages.get(name)
    if (dir === undefined) return { external: name }
    const hit = join_(dir, `lib/${rest.join('/')}`)

    return ctx.set.has(hit) ? { file: hit } : undefined
  }
  const hit = posix.join(posix.dirname(from), spec)

  return ctx.set.has(hit) ? { file: hit } : undefined
}

// ---------------------------------------------------------------- cosa offre un file e a cosa serve

// I nomi che un file mette a disposizione degli altri (al massimo 40).
export function exportsOf(text, ext) {
  const names = []
  const add = name => {
    if (name && !names.includes(name) && names.length < 40) names.push(name)
  }
  if (READER[ext] === 'js') {
    const declared =
      /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
    for (const match of text.matchAll(declared)) add(match[1])
    for (const match of text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)) {
      for (const part of match[1].split(',')) {
        const name = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop().trim()
        if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name)
      }
    }
    if (names.length === 0 && /^export\s+default\b/m.test(text)) add('default')
  } else if (ext === '.py') {
    for (const match of text.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/gm)) add(match[1])
  } else if (ext === '.go') {
    for (const match of text.matchAll(/^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([A-Z]\w*)/gm)) add(match[1])
  } else if (ext === '.rs') {
    for (const match of text.matchAll(/^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s+(\w+)/gm)) add(match[1])
  } else if (ext === '.java' || ext === '.kt') {
    for (const match of text.matchAll(/^(?:public\s+)?(?:abstract\s+|final\s+|data\s+|sealed\s+)*(?:class|interface|enum|object)\s+(\w+)/gm)) add(match[1])
  }

  return names
}

// Il commento in testa al file, se c'è: spesso dice a cosa serve.
export function aboutOf(text) {
  const lines = text.split('\n', 60)
  const isNoise = line =>
    /^\s*$/.test(line) ||
    /^#!/.test(line) ||
    /^\s*['"]use (client|server|strict)['"];?\s*$/.test(line) ||
    /^\s*\/\/\s*(@ts-|eslint|prettier|biome|#region|<reference)/.test(line) ||
    /^\s*\/\*\s*(eslint|prettier|biome|global)\b/.test(line) ||
    /^\s*#\s*-\*-/.test(line) ||
    /^\s*#\s*(type:|noqa|pylint|frozen_string_literal)/.test(line)
  let i = 0
  while (i < lines.length && isNoise(lines[i])) i += 1
  const out = []
  const first = lines[i] ?? ''
  if (/^\s*\/\*/.test(first)) {
    for (; i < lines.length; i += 1) {
      const line = lines[i]
      out.push(line.replace(/^\s*\/?\*+\/?/, '').replace(/\*+\/\s*$/, ''))
      if (line.includes('*/')) break
    }
  } else if (/^\s*\/\//.test(first)) {
    for (; i < lines.length && /^\s*\/\//.test(lines[i]); i += 1) out.push(lines[i].replace(/^\s*\/\/+/, ''))
  } else if (/^\s*#(?!!)/.test(first)) {
    for (; i < lines.length && /^\s*#/.test(lines[i]); i += 1) out.push(lines[i].replace(/^\s*#+/, ''))
  } else if (/^\s*[rRuU]?("""|''')/.test(first)) {
    const quote = first.includes('"""') ? '"""' : "'''"
    const rest = first.slice(first.indexOf(quote) + 3)
    if (rest.includes(quote)) {
      out.push(rest.slice(0, rest.indexOf(quote)))
    } else {
      out.push(rest)
      for (i += 1; i < lines.length && !lines[i].includes(quote); i += 1) out.push(lines[i])
      if (i < lines.length) out.push(lines[i].slice(0, lines[i].indexOf(quote)))
    }
  }
  const sentence = out
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('@') && !/^[-=*#_]{3,}$/.test(line))
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (sentence.length < 12 || /copyright|license|licence|spdx|generated by|do not edit|^syntax=/i.test(sentence)) return undefined
  // un commento che è solo il percorso del file non dice niente
  if (/^[\w@.\/\-[\]()]+$/.test(sentence)) return undefined
  if (sentence.length <= 160) return sentence
  const cut = sentence.slice(0, 160)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))

  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

// Quando è cambiato ogni file e quante volte negli ultimi 90 giorni (dalla storia git).
function gitActivity(root) {
  const activity = new Map()
  try {
    const out = execFileSync('git', ['-C', root, 'log', '--format=%x00%ct', '--name-only', '--relative', '-n', '4000'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const now = Date.now() / 1000
    for (const chunk of out.split('\0')) {
      const lines = chunk.split('\n')
      const when = Number(lines[0])
      if (!Number.isFinite(when) || when === 0) continue
      for (const path of lines.slice(1)) {
        if (path === '') continue
        const row = activity.get(path) ?? { last: when, recent: 0 }
        if (when > row.last) row.last = when
        if (now - when < 90 * 86400) row.recent += 1
        activity.set(path, row)
      }
    }
  } catch {
    // niente storia git: niente date
  }

  return activity
}

// ---------------------------------------------------------------- chiamate alle API del progetto

// Le pagine spesso parlano con il server con fetch('/api/...'), non con un import:
// queste regole trovano i file che rispondono a ogni indirizzo, così anche quelle
// frecce si vedono. Next.js (app e pages), SvelteKit e Nuxt.
const ROUTE_FILES = [
  /^(?:.*\/)?app\/((?:.*\/)?)route\.[cm]?[jt]sx?$/,
  /^(?:.*\/)?pages\/(api\/(?:.*\/)?[^/]+?)\.[cm]?[jt]sx?$/,
  /^(?:.*\/)?routes\/((?:.*\/)?)\+server\.[jt]s$/,
  /^(?:.*\/)?server\/(api\/(?:.*\/)?[^/]+?)\.[jt]s$/,
]

function routeSegment(seg) {
  if (/^\[\[\.\.\..*\]\]$/.test(seg)) return { rest: true, optional: true }
  if (/^\[\.\.\..*\]$/.test(seg)) return { rest: true }
  if (/^\[.*\]$/.test(seg) || seg.startsWith(':')) return { param: true }

  return { lit: seg }
}

export function apiRoutes(paths) {
  const out = []
  for (const path of paths) {
    for (const rule of ROUTE_FILES) {
      const match = rule.exec(path)
      if (match === null) continue
      const segs = match[1]
        .replace(/\.(get|post|put|patch|delete|head|options)$/, '')
        .split('/')
        .filter(seg => seg !== '' && seg !== 'index' && !/^\(.*\)$/.test(seg) && !seg.startsWith('@'))
      if (segs[0] !== 'api' && !rule.source.includes('route')) break
      out.push({ file: path, segs: segs.map(routeSegment) })
      break
    }
  }

  return out
}

// Gli indirizzi "/api/..." scritti nel codice; ${...} diventa "*".
export function apiUrls(text) {
  const out = new Set()
  for (const match of text.matchAll(/(["'`])(\/api\/[^"'`\s]*)/g)) {
    let url = match[2]
    if (match[1] === '`') url = url.replace(/\$\{[^}]*\}?/g, '*')
    url = url.split(/[?#]/)[0].replace(/\/+$/, '')
    if (url !== '' && !url.includes('$')) out.add(url)
  }

  return [...out]
}

function fitRoute(parts, segs) {
  let score = 0
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i]
    if (seg.rest) return parts.length > i || seg.optional ? score : -1
    const part = parts[i]
    if (part === undefined || part === '') return -1
    const isWild = part.includes('*')
    if (seg.param) {
      score += /^\*+$/.test(part) ? 1 : isWild ? 0 : 1
    } else if (part === seg.lit) {
      score += 2
    } else if (isWild && new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*')}$`).test(seg.lit)) {
      score += /^\*+$/.test(part) ? 0 : 2
    } else {
      return -1
    }
  }

  return parts.length === segs.length ? score : -1
}

export function matchRoute(url, routes) {
  const parts = url.replace(/^\/+|\/+$/g, '').split('/')
  let best
  let bestScore = -1
  for (const route of routes) {
    const score = fitRoute(parts, route.segs)
    if (score > bestScore) {
      best = route.file
      bestScore = score
    }
  }

  return best
}

// ---------------------------------------------------------------- indirizzi fuori dal progetto

// Gli indirizzi che il codice chiama senza una libreria: https://host e le variabili
// d'ambiente che contengono un indirizzo (PAYMENTS_SERVICE_URL). Così si trovano i servizi
// esterni raggiunti via HTTP, compresi altri servizi dello stesso prodotto.
const IGNORED_HOST =
  /(^|\.)(localhost|example\.(com|org|net)|[^.]+\.(invalid|test|local|example)|w3\.org|schemas\.(openxmlformats\.org|microsoft\.com|android\.com)|xmlns\.com|purl\.org|json-schema\.org|schema\.org|ogp\.me|github\.com|githubusercontent\.com|gitlab\.com|unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|npmjs\.(com|org)|nodejs\.org|nextjs\.org|react\.dev|reactjs\.org|vercel\.com|tailwindcss\.com|developer\.mozilla\.org|mozilla\.org|stackoverflow\.com|wikipedia\.org|apache\.org|opensource\.org|creativecommons\.org|scripts\.sil\.org|ns\.adobe\.com|shields\.io|semver\.org|keepachangelog\.com|conventionalcommits\.org|docs\.[a-z0-9.-]+)$/
export function reachOf(text) {
  const out = new Set()
  for (const match of text.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const host = match[1].toLowerCase()
    if (!/^\d+(\.\d+){3}$/.test(host) && !IGNORED_HOST.test(host)) out.add(host)
  }
  const env = /(?:process\.env\.|import\.meta\.env\.|process\.env\[\s*['"]|os\.environ(?:\.get)?[([]\s*['"]|os\.getenv\(\s*['"]|Deno\.env\.get\(\s*['"]|getenv\(\s*['"])([A-Z][A-Z0-9_]*_(?:URL|URI|HOST|ENDPOINT))\b/g
  for (const match of text.matchAll(env)) out.add(match[1])

  return [...out].sort()
}

// ---------------------------------------------------------------- la scansione

export function scanProject(rootInput) {
  const root = resolve(rootInput)
  const files = []
  let isTruncated = false
  for (const raw of listFiles(root)) {
    const path = raw.split(sep).join('/')
    if (path.split('/').some(part => SKIP_DIRS.has(part))) continue
    const info = classify(path)
    if (info === undefined) continue
    let stat
    try {
      stat = statSync(join(root, path))
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue
    files.push({ path, ext: info.ext, language: info.language, size: stat.size, loc: 0, imports: [], calls: [], externals: [], exports: [], reach: [] })
    if (files.length >= MAX_FILES) {
      isTruncated = true
      break
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1))

  const paths = files.map(file => file.path)
  const set = new Set(paths)
  const texts = new Map()
  for (const file of files) {
    let text
    try {
      text = readFileSync(join(root, file.path), 'utf8')
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    texts.set(file.path, text)
    file.loc = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    file.exports = exportsOf(text, file.ext)
    if (READER[file.ext] !== undefined) file.reach = reachOf(text)
    const about = aboutOf(text)
    if (about !== undefined) file.about = about
  }
  const activity = gitActivity(root)
  for (const file of files) {
    const row = activity.get(file.path)
    if (row !== undefined) {
      file.last = row.last
      file.recent = row.recent
    }
  }

  const { packages, manifests } = loadWorkspaces(root, paths)
  const byBase = new Map()
  for (const path of paths) {
    const name = posix.basename(path)
    byBase.set(name, [...(byBase.get(name) ?? []), path])
  }
  const ctx = {
    set,
    byBase,
    packages,
    manifests,
    aliases: loadAliases(root, paths),
    go: loadGo(root, paths),
    rustCrates: loadRust(root, paths),
    java: loadJava(root, paths, texts),
    dartPackages: loadDart(root, paths),
  }

  const read = new Set()
  for (const file of files) {
    const text = texts.get(file.path)
    const reader = READER[file.ext]
    if (text === undefined || reader === undefined) continue
    read.add(file.path)
    const internal = new Set()
    const external = new Set()
    const take = hit => {
      if (hit === undefined) return
      for (const one of hit.files ?? (hit.file !== undefined ? [hit.file] : [])) if (one !== file.path) internal.add(one)
      if (hit.external !== undefined) external.add(hit.external)
    }
    switch (reader) {
      case 'js':
        for (const spec of jsSpecs(text)) take(resolveJs(spec, file.path, ctx))
        break
      case 'css':
        for (const spec of cssSpecs(text)) take(resolveCss(spec, file.path, ctx))
        break
      case 'py':
        for (const spec of pySpecs(text)) take(resolvePy(spec, file.path, ctx))
        break
      case 'go':
        for (const spec of goSpecs(text)) take(resolveGo(spec, ctx))
        break
      case 'rs':
        for (const spec of rsSpecs(text)) take(resolveRs(spec, file.path, ctx))
        break
      case 'java':
        for (const match of text.matchAll(/^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+(?:\.\*)?)/gm)) take(resolveJava(match[1], ctx))
        break
      case 'c':
        for (const match of text.matchAll(/^[ \t]*#[ \t]*(?:include|import)[ \t]+"([^"]+)"/gm)) take(resolveC(match[1], file.path, ctx))
        break
      case 'dart':
        for (const match of text.matchAll(/^[ \t]*(?:import|export|part)[ \t]+(?:'([^']+)'|"([^"]+)")/gm)) take(resolveDart(match[1] ?? match[2], file.path, ctx))
        break
    }
    file.imports = [...internal].sort()
    file.externals = [...external].sort()
  }

  // ...e le chiamate HTTP alle API del progetto
  const routes = apiRoutes(paths)
  if (routes.length > 0) {
    for (const file of files) {
      const text = texts.get(file.path)
      if (text === undefined || READER[file.ext] !== 'js' || !text.includes('/api/')) continue
      const hits = new Set()
      for (const url of apiUrls(text)) {
        const target = matchRoute(url, routes)
        if (target !== undefined && target !== file.path) hits.add(target)
      }
      file.calls = [...hits].sort()
    }
  }

  const importedBy = new Map()
  for (const file of files) for (const target of file.imports) importedBy.set(target, (importedBy.get(target) ?? 0) + 1)
  for (const file of files) file.importedBy = importedBy.get(file.path) ?? 0

  return { root, name: projectName(root, manifests), files, texts, manifests, isTruncated, readCount: read.size }
}

function projectName(root, manifests) {
  const name = manifests.get('')?.name

  return typeof name === 'string' && name !== '' ? name : basename(root)
}

// ---------------------------------------------------------------- la panoramica per Claude

function count(n) {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}k`

  return String(n)
}

function readme(root) {
  for (const name of ['README.md', 'readme.md', 'README.MD', 'README']) {
    try {
      const text = readFileSync(join(root, name), 'utf8')
      const paragraph = text
        .split(/\n\s*\n/)
        .map(block => block.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim())
        .find(block => block.length > 30 && !block.startsWith('<'))
      if (paragraph !== undefined) return paragraph.slice(0, 320)
    } catch {
      // niente README
    }
  }

  return undefined
}

function manifestLines(scan) {
  const lines = []
  for (const [dir, json] of scan.manifests) {
    const where = dir === '' ? 'package.json' : `${dir}/package.json`
    const deps = Object.keys({ ...json.dependencies, ...json.devDependencies })
    const scripts = Object.keys(json.scripts ?? {}).slice(0, 8)
    lines.push(
      `- ${where}: ${json.name}` +
        (json.description ? ` — ${String(json.description).slice(0, 120)}` : '') +
        (scripts.length > 0 ? `; scripts: ${scripts.join(', ')}` : '') +
        (deps.length > 0 ? `; deps: ${deps.slice(0, 18).join(', ')}${deps.length > 18 ? ` (+${deps.length - 18})` : ''}` : ''),
    )
    if (lines.length >= 10) break
  }
  for (const [name, pattern] of [
    ['pyproject.toml', /^name\s*=\s*"([^"]+)"/m],
    ['go.mod', /^module\s+(\S+)/m],
    ['Cargo.toml', /^name\s*=\s*"([^"]+)"/m],
    ['pubspec.yaml', /^name:\s*(\S+)/m],
    ['composer.json', /"name"\s*:\s*"([^"]+)"/],
  ]) {
    try {
      const text = readFileSync(join(scan.root, name), 'utf8')
      lines.push(`- ${name}: ${pattern.exec(text)?.[1] ?? '(senza nome)'}`)
    } catch {
      // quel manifesto non c'è
    }
  }

  return lines
}

export function outline(scan) {
  const { files } = scan
  const out = []
  const totalLoc = files.reduce((sum, file) => sum + file.loc, 0)
  out.push(`# Pharos scan: ${scan.name}`)
  out.push(`root: ${scan.root}`)
  out.push(`files: ${files.length} · lines: ${count(totalLoc)}${scan.isTruncated ? ` · (stopped at ${MAX_FILES} files)` : ''}`)

  const byLanguage = new Map()
  for (const file of files) byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + file.loc)
  const languages = [...byLanguage].sort((a, b) => b[1] - a[1]).slice(0, 6)
  out.push(`languages: ${languages.map(([name, loc]) => `${name} ${totalLoc > 0 ? Math.round((loc / totalLoc) * 100) : 0}%`).join(', ')}`)
  const intro = readme(scan.root)
  if (intro !== undefined) out.push(`readme: ${intro}`)
  const manifests = manifestLines(scan)
  if (manifests.length > 0) out.push('', '## Manifests', ...manifests)

  // Le cartelle da mostrare: quelle grandi si aprono nelle loro sottocartelle.
  const tree = new Map([['', { files: 0, loc: 0, own: 0, children: new Set() }]])
  for (const file of files) {
    const parts = file.path.split('/')
    parts.pop()
    let path = ''
    const root = tree.get('')
    root.files += 1
    root.loc += file.loc
    for (const part of parts) {
      const next = path === '' ? part : `${path}/${part}`
      tree.get(path).children.add(next)
      if (!tree.has(next)) tree.set(next, { files: 0, loc: 0, own: 0, children: new Set() })
      path = next
      const node = tree.get(path)
      node.files += 1
      node.loc += file.loc
    }
    tree.get(path).own += 1
  }
  const build = threshold => {
    const printed = []
    const visit = (path, depth) => {
      for (const child of [...tree.get(path).children].sort()) {
        printed.push({ path: child, depth })
        if (depth < 3 && tree.get(child).files >= threshold && tree.get(child).children.size > 0) visit(child, depth + 1)
      }
    }
    visit('', 1)

    return printed
  }
  let threshold = 12
  let printed = build(threshold)
  while (printed.length > 60 && threshold < 100_000) {
    threshold = Math.ceil(threshold * 1.6)
    printed = build(threshold)
  }
  const shown = new Set(printed.map(one => one.path))
  const owner = path => {
    let dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    while (dir !== '' && !shown.has(dir)) dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir)

    return dir === '' ? '(root)' : dir
  }
  const links = new Map()
  const outside = new Map()
  for (const file of files) {
    const from = owner(file.path)
    for (const target of file.imports) {
      const to = owner(target)
      if (to === from) continue
      const row = links.get(from) ?? new Map()
      row.set(to, (row.get(to) ?? 0) + 1)
      links.set(from, row)
    }
    const pkgs = outside.get(from) ?? new Map()
    for (const name of file.externals) pkgs.set(name, (pkgs.get(name) ?? 0) + 1)
    outside.set(from, pkgs)
  }
  const top = (map, n) =>
    [...(map ?? [])]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, n)
      .map(([name, value]) => `${name} ${value}`)
      .join(', ')

  out.push('', '## Folders  (files · lines; "→" = which other folders its files import, with how many files do; "uses" = external packages)')
  const rootFiles = files.filter(file => !file.path.includes('/'))
  if (rootFiles.length > 0) out.push(`(root) ${rootFiles.length} files: ${rootFiles.map(file => file.path).slice(0, 14).join(', ')}${rootFiles.length > 14 ? ', …' : ''}`)
  for (const { path, depth } of printed) {
    const node = tree.get(path)
    const isOpen = node.children.size > 0 && printed.some(other => other.path.startsWith(`${path}/`) && other.depth === depth + 1)
    const line =
      `${'  '.repeat(depth - 1)}${path.split('/').pop()}/  ${node.files} files · ${count(node.loc)}` +
      (isOpen && node.own > 0 ? ` (${node.own} directly here)` : '')
    const arrows = top(links.get(path), 4)
    const uses = top(outside.get(path), 4)
    out.push(line + (arrows !== '' ? `  → ${arrows}` : '') + (uses !== '' ? `  | uses ${uses}` : ''))
  }

  const hubs = [...files].filter(file => file.importedBy >= 3).sort((a, b) => b.importedBy - a.importedBy).slice(0, 8)
  if (hubs.length > 0) out.push('', '## Most imported files', ...hubs.map(file => `${file.path}  ← ${file.importedBy} files`))

  const isNoise = path => /(^|\/)(tests?|__tests__|specs?|e2e|stories|mocks?|fixtures)\//.test(path) || /\.(test|spec|stories|config)\.|\.d\.ts$/.test(path)
  const entries = files
    .filter(file => file.importedBy === 0 && file.imports.length > 0 && !isNoise(file.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.imports.length - a.imports.length)
    .slice(0, 8)
  if (entries.length > 0) out.push('', '## Likely entry points  (nothing imports them)', ...entries.map(file => `${file.path}  → ${file.imports.length} files`))

  const packages = new Map()
  for (const file of files) for (const name of file.externals) packages.set(name, (packages.get(name) ?? 0) + 1)
  if (packages.size > 0) {
    out.push('', '## External packages  (how many files import each)')
    out.push([...packages].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([name, n]) => `${name} ${n}`).join(', '))
  }

  const links2 = files.reduce((sum, file) => sum + file.imports.length, 0)
  out.push('', '## Not read', 'git-ignored files, dependencies and build output (node_modules, dist, build…), hidden files and folders except .github, data JSON, images and other binaries.')
  out.push('', '## Import analysis')
  out.push(`${scan.readCount} of ${files.length} files were read for imports; ${links2} links between files found.`)
  const callers = files.filter(file => file.calls.length > 0)
  if (callers.length > 0) out.push(`${callers.length} files call the project's own API by address (fetch('/api/…')); those arrows are drawn too.`)
  const unsupported = [...new Set(files.filter(file => READER[file.ext] === undefined && !['Markdown', 'JSON', 'YAML', 'TOML', 'HTML', 'SQL', 'Shell', 'Docker', 'Make', 'Config', 'Terraform', 'Prisma', 'GraphQL', 'Protobuf'].includes(file.language)).map(file => file.language))]
  if (unsupported.length > 0) out.push(`No import analysis for: ${unsupported.join(', ')}. Describe the links involving those files yourself in the map.`)
  if (links2 < 5 && scan.readCount > 5) out.push('Very few links were found: describe the main ones yourself in the map.')
  out.push('To see the files of one folder: add --files <folder>.')

  return out.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const target = args.find((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--files') ?? process.cwd()
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error(`Pharos: "${target}" is not a folder.`)
    process.exit(1)
  }
  const scan = scanProject(target)
  if (scan.files.length === 0) {
    console.error('Pharos: no source files found in that folder.')
    process.exit(1)
  }
  const at = args.indexOf('--files')
  if (at !== -1) {
    // I file di una cartella, per decidere a quale blocco vanno.
    const prefix = (args[at + 1] ?? '').replace(/^\.\//, '').replace(/\/?$/, '/')
    const list = scan.files.filter(file => prefix === '/' || file.path.startsWith(prefix))
    if (list.length === 0) console.log(`No files under ${prefix}`)
    else console.log('path  lines  → files it imports  ← files that import it')
    for (const file of list) {
      console.log(`${file.path}  ${count(file.loc)} lines${file.imports.length > 0 ? `  → ${file.imports.length}` : ''}${file.importedBy > 0 ? `  ← ${file.importedBy}` : ''}`)
    }
  } else if (args.includes('--json')) {
    console.log(JSON.stringify({ ...scan, texts: undefined, manifests: undefined }, null, 1))
  } else {
    console.log(outline(scan))
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
