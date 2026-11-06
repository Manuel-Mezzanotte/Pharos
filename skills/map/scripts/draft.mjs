#!/usr/bin/env node
// La bozza di Pharos: un algoritmo che disegna da solo la struttura della mappa.
//
// 1. Ogni file riceve il suo strato (pagine, API, componenti, logica, dati,
//    condiviso, test, strumenti) da regole fisse su rotte, cartelle e nomi.
// 2. Ogni strato è un blocco. Le pagine e le API seguono le rotte dell'app;
//    il resto segue le cartelle.
// 3. Una cartella piatta e grande si divide per argomento: le parole che
//    tornano nei nomi dei file (invoice-*, order-*…).
// 4. I gruppi troppo piccoli, o troppi, si uniscono a quelli con cui parlano di
//    più: import, chiamate HTTP, file che cambiano insieme nei commit, parole
//    in comune.
//
// Scrive .pharos/map.json con nomi automatici; Claude dà i nomi veri in
// .pharos/names.json, che render.mjs sovrappone. Stessa cartella, stessa mappa.
//
//   node draft.mjs [cartella-del-progetto] [--lang it|en] [--out file] [--force] [--json]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compilePattern } from './render.mjs'
import { scanProject } from './scan.mjs'

export const GENERATOR = 'pharos-draft/1'

const LEAF_MAX = 40 // una parte che non si apre tiene al massimo questi file
const PART_MIN = 3 // i gruppi più piccoli si uniscono al più vicino
const MAX_PARTS = 10 // parti per sezione
const DOMINANT = 0.6 // una parte con più di questa quota della sezione la domina
const MAX_EXTERNAL = 10

// ---------------------------------------------------------------- parole

const BLOCKS = {
  pages: { kind: 'interface', it: 'Pagine', en: 'Pages' },
  api: { kind: 'api', it: 'API', en: 'API' },
  ui: { kind: 'interface', it: 'Componenti', en: 'Components' },
  logic: { kind: 'logic', it: 'Logica', en: 'Logic' },
  data: { kind: 'data', it: 'Dati', en: 'Data' },
  shared: { kind: 'shared', it: 'Condiviso', en: 'Shared' },
  tests: { kind: 'test', it: 'Test', en: 'Tests' },
  tooling: { kind: 'tooling', it: 'Strumenti', en: 'Tooling' },
  docs: { kind: 'docs', it: 'Documentazione', en: 'Docs' },
}
const ORDER = Object.keys(BLOCKS)

const WORDS = {
  it: { overview: 'Panoramica', home: 'Home', base: 'Base', and: 'e', files: 'file', interface: 'Interfaccia', uses: 'usato da', service: name => `Servizio ${name}`, backend: 'Backend' },
  en: { overview: 'Overview', home: 'Home', base: 'Base', and: 'and', files: 'files', interface: 'Interface', uses: 'used by', service: name => `${name} service`, backend: 'Backend' },
}

// Parole che non dicono l'argomento di un file: il suo tipo, un'azione, un pezzo di interfaccia.
const STOP = new Set(
  ('index page layout route loading error not found template default main app src lib api ' +
    'service services model models schema schemas controller controllers handler handlers router routes ' +
    'test tests spec specs mock mocks fixture fixtures contract contracts type types interface interfaces ' +
    'util utils helper helpers constant constants config client server hook use get set create update delete remove ' +
    'list new edit add view views form forms dialog modal card button panel section table row item items sheet tab tabs ' +
    'provider context store state query queries request response http data core base common shared wrapper ' +
    'required pending signed managed demo active current custom global public private internal external generic simple ' +
    'auto manual legacy old temp lazy live fake dummy sample single multi batch bulk full partial empty initial final ' +
    'the and of for to by with in on is it its v1 v2 v3 tsx jsx ts js mjs cjs py go rs java kt dart vue svelte').split(' '),
)

// Cartelle che sono uno strato, non un argomento: quando una di loro riempie
// quasi tutto un blocco, le sue parti salgono di un livello.
const LAYER_WORDS = new Set(
  ('components component ui views screens pages models model entities schemas services service controllers ' +
    'routes handlers api utils helpers lib src app core common shared tests test __tests__ spec specs scripts ' +
    'tools hooks types source sources pkg internal').split(' '),
)

const ACRONYMS = new Set('api ui ux db sql id url pdf csv ai sdk cli ci cd aws s3 jwt sso seo kpi crm erp iot ml llm html css json xml http rpc dto orm iam vat iva'.split(' '))

export function words(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function stem(word) {
  if (word.length <= 3) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (/(ss|us|is)$/.test(word)) return word
  if (/(xes|ches|shes|sses)$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)

  return word
}

const baseName = path => path.slice(path.lastIndexOf('/') + 1)
const folderOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')
const parentFolder = folder => {
  const trimmed = folder.slice(0, -1)

  return trimmed.includes('/') ? trimmed.slice(0, trimmed.lastIndexOf('/') + 1) : ''
}

// Le parole-argomento nel nome di un file, in ordine: "expense-line.service.ts" → expense, line.
export function topicWords(path) {
  const name = baseName(path).replace(/\.[^.]+$/, '')

  return [...new Set(words(name).map(stem).filter(word => word.length > 1 && !STOP.has(word) && !/^\d+$/.test(word)))]
}

function humanize(text) {
  const parts = words(text)
  if (parts.length === 0) return text
  const out = parts.map((word, i) => {
    if (ACRONYMS.has(word) || (word.length <= 5 && !/[aeiouy]/.test(word))) return word.toUpperCase()

    return i === 0 ? word[0].toUpperCase() + word.slice(1) : word
  })

  return out.join(' ')
}

export function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'part'
  )
}

// ---------------------------------------------------------------- 1. lo strato di ogni file

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress', 'playwright', '__mocks__', 'testing', 'test-utils', 'testdata'])
const TOOL_DIRS = new Set([
  'scripts', 'script', 'bin', 'tools', 'tooling', '.github', '.gitlab', '.circleci', '.helm', 'helm', 'charts', 'infra',
  'infrastructure', 'deploy', 'deployment', 'deployments', 'k8s', 'kubernetes', 'terraform', 'ci', 'docker', '.husky',
  '.semantic-version', '.changeset', 'public', '.devcontainer', 'ops',
])
const DOC_DIRS = new Set(['docs', 'doc', 'documentation', 'wiki', 'adr', 'adrs'])
const SEGMENT_ROLE = new Map()
for (const [role, list] of Object.entries({
  ui: 'components component ui views view screens screen layouts widgets hooks composables styles css scss emails email-templates frontend client web assets static icons i18n locales stories theme themes',
  api: 'api apis routes router routers controllers controller handlers endpoints resolvers graphql rest rpc trpc webhooks',
  data: 'models model schema schemas db database databases migrations migration entities entity repositories repository repos dao prisma drizzle seeds seeders orm',
  logic: 'services service domain core usecases use-cases application workers worker jobs queues queue tasks cron middleware middlewares server integrations adapters providers policies guards validation validators audit auth actions commands features modules engine pipelines',
  shared: 'utils util utilities helpers helper common shared types typings @types constants config configs interfaces contracts',
})) {
  for (const word of list.split(' ')) SEGMENT_ROLE.set(word, role)
}

const TOOL_FILE = /^(dockerfile.*|makefile|procfile|package\.json|tsconfig[\w.-]*\.json|jsconfig\.json|pnpm-workspace\.yaml|docker-compose[\w.-]*\.ya?ml|.*\.config\.[cm]?[jt]s|.*\.config\.json|vercel\.json|netlify\.toml|turbo\.json|nx\.json|biome\.json|go\.mod|cargo\.toml|pyproject\.toml|setup\.py|requirements[\w.-]*\.txt)$/i

function strongSuffix(name) {
  if (/\.(model|entity|schema|repository|repo|dao|migration)\.[^.]+$/i.test(name) || /^(models|schema|db|database|prisma|mongo|mongodb|redis|knex|drizzle|sequelize)\.[^.]+$/i.test(name)) return 'data'
  if (/\.(service|worker|job|usecase|policy|guard|middleware)\.[^.]+$/i.test(name)) return 'logic'
  if (/\.(controller|routes?|router|handler|resolver|endpoint)\.[^.]+$/i.test(name) || /^(views|urls|serializers|routes|router|handlers)\.py$/.test(name)) return 'api'
  if (/\.(component|page|screen|view)\.[^.]+$/i.test(name)) return 'ui'

  return undefined
}

function weakName(path, ext) {
  const name = baseName(path)
  if (/\.d\.ts$/.test(name) || /[-.](contract|types?|constants?|dto)\.[^.]+$/i.test(name) || /^(types|constants|config|settings)\.[^.]+$/i.test(name)) return 'shared'
  if (/^use[-A-Z]/.test(name)) return 'ui'
  if (['.vue', '.svelte', '.astro', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.tsx', '.jsx'].includes(ext)) return 'ui'
  if (['.sql', '.prisma'].includes(ext)) return 'data'
  if (['.graphql', '.gql', '.proto'].includes(ext)) return 'api'

  return undefined
}

export function findRouteRoots(scan) {
  const deps = new Set()
  for (const json of scan.manifests?.values?.() ?? []) for (const name of Object.keys({ ...json.dependencies, ...json.devDependencies })) deps.add(name)
  const roots = new Map()
  for (const file of scan.files) {
    const path = file.path
    let match = /^((?:[^/]+\/)*?app\/)(?:.*\/)?(?:page|route|layout)\.[cm]?[jt]sx?$/.exec(path)
    if (match !== null && !roots.has(match[1])) {
      roots.set(match[1], 'next-app')
      continue
    }
    match = /^((?:[^/]+\/)*?src\/routes\/)(?:.*\/)?\+(?:page|layout|server)(?:\.server)?\.(?:svelte|[jt]s)$/.exec(path)
    if (match !== null) {
      roots.set(match[1], 'sveltekit')
      continue
    }
    match = /^((?:[^/]+\/)*?server\/)api\//.exec(path)
    if (match !== null && deps.has('nuxt')) {
      roots.set(match[1], 'nitro')
      continue
    }
    match = /^((?:[^/]+\/)*?pages\/)/.exec(path)
    if (match !== null && (deps.has('next') || deps.has('nuxt')) && !roots.has(match[1])) roots.set(match[1], deps.has('nuxt') ? 'nuxt' : 'next-pages')
  }

  return roots
}

// Le pagine e le API seguono le rotte: la cartella di ogni file senza parametri ([id]),
// gruppi ((shop)), slot (@modal) e cartelle private (_parts).
function routeOf(path, roots) {
  let best
  for (const [prefix, type] of roots) if (path.startsWith(prefix) && (best === undefined || prefix.length > best.prefix.length)) best = { prefix, type }
  if (best === undefined) return undefined
  const rel = path.slice(best.prefix.length).split('/')
  const name = rel.pop()
  if (best.type === 'next-pages' || best.type === 'nuxt' || best.type === 'nitro') {
    const stemName = name.replace(/\.[^.]+$/, '').replace(/\.(get|post|put|patch|delete)$/, '')
    if (!['index', '_app', '_document', '_error', '404', '500'].includes(stemName)) rel.push(stemName)
  }
  const segs = rel.filter(seg => seg !== '' && !/^\(.*\)$/.test(seg) && !/^\[.*\]$/.test(seg) && !seg.startsWith('@') && !seg.startsWith('_'))
  const isApi =
    best.type === 'nitro' ||
    (best.type === 'next-app' && (segs[0] === 'api' || /^route\.[cm]?[jt]sx?$/.test(name))) ||
    (best.type === 'next-pages' && segs[0] === 'api') ||
    (best.type === 'sveltekit' && name.startsWith('+server'))
  if (isApi && segs[0] === 'api') segs.shift()

  return { block: isApi ? 'api' : 'pages', segs }
}

const DB_PACKAGES = /^(mongoose|mongodb|pg|postgres|mysql2?|sqlite3?|better-sqlite3|@prisma\/client|prisma|drizzle-orm|typeorm|sequelize|knex|kysely|ioredis|redis|sqlalchemy|psycopg2?|pymongo|django\.db|gorm\.io\/.*)$/

export function roleOf(file, roots) {
  const path = file.path
  const name = baseName(path)
  const lower = path.toLowerCase()
  const dirs = lower.split('/').slice(0, -1)
  const isTestName = /\.(test|spec|e2e|stories)\.[^.]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.(go|py)$/.test(name)
  // un lavoro in background che usa il codice del progetto gira in produzione, anche se sta in scripts/
  if (!isTestName && /[-_.]worker\.[cm]?[jt]s$|[-_.]worker\.py$/i.test(name) && file.imports?.length > 0) return { block: 'logic' }
  if (file.language === 'Markdown') return { block: dirs.length > 0 && TOOL_DIRS.has(dirs[0]) ? 'tooling' : 'docs' }
  if (dirs.length > 0 && TOOL_DIRS.has(dirs[0]) && dirs[0] !== 'public') return { block: 'tooling' }
  if (dirs.some(dir => TEST_DIRS.has(dir)) || /\.(test|spec|e2e|stories)\.[^.]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.(go|py)$/.test(name) || /Tests?\.(java|kt|swift|cs)$/.test(name)) {
    return { block: 'tests' }
  }
  if (dirs.some(dir => TOOL_DIRS.has(dir)) || (dirs.length === 0 && TOOL_FILE.test(name)) || ['YAML', 'TOML', 'Docker', 'Make', 'Config', 'Terraform', 'Shell', 'PowerShell', 'JSON'].includes(file.language)) {
    return { block: 'tooling' }
  }
  if (dirs.some(dir => DOC_DIRS.has(dir)) || file.language === 'Markdown') return { block: 'docs' }
  const route = routeOf(path, roots)
  if (route !== undefined) return route
  const strong = strongSuffix(name)
  if (strong !== undefined) return { block: strong }
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const role = SEGMENT_ROLE.get(dirs[i])
    // "schemas/" può essere il database o solo la forma dei dati (zod): decide chi usa
    if (role === 'data' && (dirs[i] === 'schema' || dirs[i] === 'schemas') && !file.externals.some(name => DB_PACKAGES.test(name)) && !['.sql', '.prisma'].includes(file.ext)) continue
    if (role !== undefined) return { block: role }
  }

  return { block: weakName(path, file.ext) }
}

// Chi non ha regole decide dal codice, una cartella alla volta: chi lo usa, cosa usa.
function voteRoles(files, roles, byPath) {
  // codice in scripts/ o bin/ che i test (o il prodotto) importano è il prodotto, non uno strumento
  const usedBy = new Map()
  for (const file of files) for (const target of file.imports) usedBy.set(target, [...(usedBy.get(target) ?? []), file.path])
  for (const file of files) {
    if (roles.get(file.path).block !== 'tooling' || !['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Ruby'].includes(file.language)) continue
    if ((usedBy.get(file.path) ?? []).some(user => roles.get(user).block !== 'tooling')) roles.set(file.path, { block: undefined })
  }
  const pending = files.filter(file => roles.get(file.path).block === undefined)
  const folders = new Map()
  for (const file of pending) folders.set(folderOf(file.path), [...(folders.get(folderOf(file.path)) ?? []), file])
  const users = new Map()
  for (const file of files) {
    for (const target of [...file.imports, ...file.calls]) users.set(target, [...(users.get(target) ?? []), file.path])
  }
  for (const [folder, list] of folders) {
    const depth = folder.split('/').length - 1
    // i file sciolti in lib/ o src/ sono di tutti
    if (depth <= 1 || list.length === 1) {
      for (const file of list) {
        const usesDb = file.externals.some(name => DB_PACKAGES.test(name))
        roles.set(file.path, { block: usesDb && list.length === 1 && depth > 1 ? 'data' : 'shared' })
      }
      continue
    }
    const inside = new Set(list.map(file => file.path))
    const callers = new Map()
    let touchesData = false
    for (const file of list) {
      if (file.externals.some(name => DB_PACKAGES.test(name))) touchesData = true
      for (const target of file.imports) if (!inside.has(target) && roles.get(target)?.block === 'data') touchesData = true
      for (const user of users.get(file.path) ?? []) {
        if (inside.has(user)) continue
        const role = roles.get(user)?.block
        if (role !== undefined && role !== 'tests' && role !== 'tooling') callers.set(role, (callers.get(role) ?? 0) + 1)
      }
    }
    let block = 'logic'
    if (!touchesData) {
      const ranked = [...callers].sort((a, b) => b[1] - a[1])
      if (ranked.length >= 3) block = 'shared'
      else if (ranked[0]?.[0] === 'ui' || ranked[0]?.[0] === 'pages') block = ranked.length > 1 ? 'shared' : 'ui'
    }
    for (const file of list) roles.set(file.path, { block })
  }
  void byPath
}

// ---------------------------------------------------------------- 2. gli argomenti e le affinità

function gitCoChange(root, known) {
  const co = new Map()
  try {
    const out = execFileSync('git', ['-C', root, 'log', '--no-merges', '--format=%x00', '--name-only', '--relative', '-n', '1500'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const chunk of out.split('\0')) {
      const list = [...new Set(chunk.split('\n').filter(path => path !== '' && known.has(path)))]
      if (list.length < 2 || list.length > 30) continue
      const weight = 1 / (list.length - 1)
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          for (const [a, b] of [[list[i], list[j]], [list[j], list[i]]]) {
            const row = co.get(a) ?? new Map()
            row.set(b, (row.get(b) ?? 0) + weight)
            co.set(a, row)
          }
        }
      }
    }
  } catch {
    // niente storia git: si fa senza
  }

  return co
}

function makeContext(scan, co) {
  const near = new Map(scan.files.map(file => [file.path, new Set()]))
  for (const file of scan.files) {
    for (const target of [...file.imports, ...file.calls]) {
      if (!near.has(target)) continue
      near.get(file.path).add(target)
      near.get(target).add(file.path)
    }
  }
  // un file usato da tutti (il controllo dei permessi, utils) non dice che due gruppi si somigliano
  const weight = new Map([...near].map(([path, set]) => [path, 1 / Math.max(1, set.size)]))
  // la forma più comune di ogni parola, per i nomi: "expenses" e "expense" → la più usata
  const forms = new Map()
  const addForm = raw => {
    const key = stem(raw.toLowerCase())
    const row = forms.get(key) ?? new Map()
    row.set(raw, (row.get(raw) ?? 0) + 1)
    forms.set(key, row)
  }
  for (const file of scan.files) {
    for (const part of file.path.split('/')) for (const raw of part.replace(/\.[^.]+$/, '').split(/[^A-Za-z0-9]+/)) if (raw !== '') addForm(raw.toLowerCase())
  }

  return { near, weight, co, forms }
}

function display(token, ctx) {
  const row = ctx.forms.get(token)
  const raw = row === undefined ? token : [...row].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]

  return humanize(raw)
}

let unitCount = 0
function unit(fields) {
  unitCount += 1

  const out = { members: null, node: null, skip: null, token: null, ...fields }
  out.uid = unitCount

  return out
}

function pathSet(u) {
  if (u.set === undefined) u.set = new Set(u.files.map(file => file.path))

  return u.set
}

function neighbours(u, ctx) {
  if (u.nb === undefined) {
    const inside = pathSet(u)
    u.nb = new Map()
    for (const path of inside) for (const other of ctx.near.get(path) ?? []) if (!inside.has(other)) u.nb.set(other, ctx.weight.get(other) ?? 0.5)
  }

  return u.nb
}

function tokenBag(u) {
  if (u.bag === undefined) {
    u.bag = new Map()
    for (const file of u.files) for (const word of topicWords(file.path)) u.bag.set(word, (u.bag.get(word) ?? 0) + 1)
    for (const word of words(u.name).map(stem)) if (!STOP.has(word)) u.bag.set(word, (u.bag.get(word) ?? 0) + Math.max(1, u.files.length / 2))
  }

  return u.bag
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [key, value] of a) {
    na += value * value
    const other = b.get(key)
    if (other !== undefined) dot += value * other
  }
  for (const value of b.values()) nb += value * value

  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0
}

export function affinity(a, b, ctx) {
  const A = pathSet(a)
  const B = pathSet(b)
  let direct = 0
  let co = 0
  for (const path of A) {
    for (const other of ctx.near.get(path) ?? []) if (B.has(other)) direct += 1
    const row = ctx.co.get(path)
    if (row !== undefined) for (const [other, weight] of row) if (B.has(other)) co += weight
  }
  const na = neighbours(a, ctx)
  const nb = neighbours(b, ctx)
  let both = 0
  let any = 0
  for (const [path, weight] of na) {
    if (B.has(path)) continue
    any += weight
    if (nb.has(path)) both += weight
  }
  for (const [path, weight] of nb) if (!A.has(path) && !na.has(path)) any += weight
  const size = Math.sqrt(A.size * B.size)

  return direct / size + 2 * (any > 0 ? both / any : 0) + co / size + 1.5 * cosine(tokenBag(a), tokenBag(b))
}

// Una cartella piatta si divide per le parole che tornano nei nomi dei suoi file.
function topicSplit(files, ctx, exclude = new Set(), restName = '', opts = { words: WORDS.en }) {
  const lists = new Map()
  const df = new Map()
  for (const file of files) {
    const list = topicWords(file.path).filter(word => !exclude.has(word))
    lists.set(file.path, list)
    for (const word of list) df.set(word, (df.get(word) ?? 0) + 1)
  }
  const cap = Math.max(PART_MIN, Math.floor(0.6 * files.length))
  const isTopic = word => df.get(word) >= PART_MIN && df.get(word) <= cap
  const groups = new Map()
  const rest = []
  for (const file of files) {
    const list = lists.get(file.path).filter(isTopic)
    if (list.length === 0) {
      rest.push(file)
      continue
    }
    let best = list[0]
    let bestScore = -1
    list.forEach((word, i) => {
      const score = df.get(word) * 0.4 ** i
      if (score > bestScore) {
        best = word
        bestScore = score
      }
    })
    groups.set(best, [...(groups.get(best) ?? []), file])
  }
  for (const [word, list] of [...groups]) {
    if (list.length < PART_MIN) {
      groups.delete(word)
      rest.push(...list)
    }
  }
  if (groups.size === 0) return null
  const units = [...groups].map(([word, list]) => unit({ name: display(word, ctx), files: list, token: word, exclude: new Set([...exclude, word]) }))
  // i file senza argomento vanno dal gruppo con cui parlano di più, se parlano con qualcuno
  const loose = []
  for (const file of rest) {
    const one = unit({ name: '', files: [file] })
    let best
    let bestScore = 0
    for (const candidate of units) {
      const score = affinity(one, candidate, ctx)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (best !== undefined && bestScore >= 0.35) best.files.push(file)
    else loose.push(file)
  }
  for (const u of units) {
    delete u.set
    delete u.nb
    delete u.bag
  }
  if (loose.length > 0) {
    const counts = new Map()
    for (const file of loose) for (const word of topicWords(file.path).filter(one => !exclude.has(one))) counts.set(word, (counts.get(word) ?? 0) + 1)
    const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
    const name = top !== undefined && top[1] >= Math.max(2, loose.length * 0.25) ? display(top[0], ctx) : restName
    units.push(unit({ name: name || restName, files: loose, token: top?.[0] ?? null, exclude, isRest: true }))
  }

  return units.length > 1 ? units : null
}

// ---------------------------------------------------------------- 3. le sezioni

function treeOf(entries) {
  const root = { seg: '', path: [], children: new Map(), own: [], count: 0 }
  for (const { file, segs } of entries) {
    let node = root
    node.count += 1
    for (const seg of segs) {
      if (!node.children.has(seg)) node.children.set(seg, { seg, path: [...node.path, seg], children: new Map(), own: [], count: 0 })
      node = node.children.get(seg)
      node.count += 1
    }
    node.own.push(file)
  }

  return root
}

function filesUnder(node, skip = null) {
  const out = [...node.own]
  for (const [seg, child] of node.children) if (skip === null || !skip.has(seg)) out.push(...filesUnder(child))

  return out
}

function nodeUnit(node, name, extra = {}) {
  return unit({ name, node, files: filesUnder(node, extra.skip ?? null), ...extra })
}

// Le parti in cui si apre un gruppo.
function partsOf(u, ctx, opts) {
  const extra = u.extra ?? []
  if (u.members !== null) return [...u.members, ...extra]
  if (u.node !== null) {
    const out = []
    for (const [seg, child] of u.node.children) {
      if (u.skip?.has(seg)) continue
      // una cartella che contiene solo un'altra cartella prende il nome di quella in fondo
      const chain = [seg]
      for (let last = child; last.own.length === 0 && last.children.size === 1; ) {
        last = [...last.children.values()][0]
        chain.push(last.seg)
      }
      out.push(nodeUnit(child, humanize(chain.join(' ')), { routeLike: u.routeLike }))
    }
    const own = u.node.own
    if (own.length > 0) {
      const ownName = u.isBlock ? (u.routeLike ? opts.words.home : opts.words.base) : u.routeLike ? opts.words.overview : opts.words.base
      const split = own.length > LEAF_MAX || (out.length === 0 && own.length > LEAF_MAX / 2) ? topicSplit(own, ctx, new Set(), ownName, opts) : null
      if (split !== null) out.push(...split.map(one => Object.assign(one, { isOwn: true })))
      else out.push(unit({ name: ownName, files: [...own], isOwn: true, isLoose: !u.routeLike }))
    }

    return [...out, ...extra]
  }

  return topicSplit(u.files, ctx, u.exclude ?? new Set(), u.name, opts) ?? []
}

function merge(units, small, target, opts) {
  // un pezzo piccolo entra in uno molto più grande senza cambiargli nome
  if (target.files.length >= 4 * small.files.length) {
    const grown = unit({ ...target, uid: undefined, files: [...target.files, ...small.files], extra: [...(target.extra ?? []), small] })
    delete grown.set
    delete grown.nb
    delete grown.bag

    return units.filter(one => one !== small && one !== target).concat(grown)
  }
  const members = [...(target.members ?? [target]), ...(small.members ?? [small])].sort((a, b) => b.files.length - a.files.length)
  const names = [...new Set(members.map(one => one.name).filter(Boolean))]
  const name = names.length <= 1 ? (names[0] ?? target.name) : names.length === 2 ? `${names[0]} ${opts.words.and} ${names[1]}` : `${names[0]}, ${names[1]} +${names.length - 2}`
  const merged = unit({ name, files: [...target.files, ...small.files], members, primary: members[0].name, routeLike: target.routeLike })

  return units.filter(one => one !== small && one !== target).concat(merged)
}

function closest(u, units, ctx, avoidSmall = false) {
  let best
  let bestScore = -1
  for (const other of units) {
    if (other === u) continue
    let score = affinity(u, other, ctx) + (other.isOwn ? 0.05 : 0)
    // due pezzi minuscoli si uniscono tra loro solo se si somigliano davvero
    if (avoidSmall && other.files.length < PART_MIN && score < 0.5) score -= 1
    if (score > bestScore || (score === bestScore && other.files.length < best.files.length)) {
      best = other
      bestScore = score
    }
  }

  return best
}

function settle(units, ctx, opts) {
  let list = [...units]
  for (;;) {
    if (list.length <= 1) break
    const small = list.filter(one => one.files.length < PART_MIN).sort((a, b) => a.files.length - b.files.length || (a.name < b.name ? -1 : 1))[0]
    if (small === undefined) break
    list = merge(list, small, closest(small, list, ctx, true), opts)
  }
  // troppe parti: si uniscono le due più simili, tra le più piccole, senza creare parti da aprire
  while (list.length > MAX_PARTS) {
    const sizes = list.map(one => one.files.length).sort((a, b) => a - b)
    const median = sizes[Math.floor(sizes.length / 2)]
    let best
    let bestScore = -Infinity
    for (const pass of [true, false]) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]
          const b = list[j]
          const sameTopic = cosine(tokenBag(a), tokenBag(b)) >= 0.5
          if (Math.min(a.files.length, b.files.length) > median && !sameTopic) continue
          if (pass && a.files.length + b.files.length > LEAF_MAX && !sameTopic) continue
          let score = affinity(a, b, ctx) + (sameTopic ? 1 : 0)
          if ((a.isOwn && a.routeLike) || (b.isOwn && b.routeLike)) score -= 0.5
          if (score > bestScore || (score === bestScore && a.files.length + b.files.length < best[0].files.length + best[1].files.length)) {
            bestScore = score
            best = a.files.length <= b.files.length ? [a, b] : [b, a]
          }
        }
      }
      if (best !== undefined) break
    }
    list = merge(list, best[0], best[1], opts)
  }

  return list
}

function arrange(units, depthLeft, ctx, opts) {
  let list = [...units]
  const total = list.reduce((sum, one) => sum + one.files.length, 0)
  // uno strato che riempie quasi tutta la sezione ("components/" dentro Componenti): le sue parti salgono
  const layer = list.find(one => one.files.length > DOMINANT * total && one.files.length > LEAF_MAX && (one.isOwn || (one.node !== null && LAYER_WORDS.has(one.node.seg.toLowerCase()))))
  if (layer !== undefined) {
    const parts = partsOf(layer, ctx, opts)
    if (parts.length > 1) list = list.filter(one => one !== layer).concat(parts)
  }
  // una parte che si dovrebbe aprire troppo in fondo sale di un livello (Organizzazione → Progetti)
  for (let round = 0; round < 4 && depthLeft <= 2; round += 1) {
    let changed = false
    for (const one of [...list]) {
      if (one.node === null || one.files.length <= LEAF_MAX) continue
      const children = [...one.node.children].filter(([seg]) => !one.skip?.has(seg))
      const big = children.find(([, child]) => filesUnder(child).length > DOMINANT * one.files.length && filesUnder(child).length > LEAF_MAX)
      if (big === undefined) continue
      const [seg, child] = big
      const skip = new Set([...(one.skip ?? []), seg])
      const rest = nodeUnit(one.node, one.name, { skip, routeLike: one.routeLike })
      const lifted = nodeUnit(child, humanize(seg), { routeLike: one.routeLike })
      list = list.filter(other => other !== one).concat(rest.files.length > 0 ? [rest, lifted] : [lifted])
      changed = true
    }
    if (!changed) break
  }

  return settle(list, ctx, opts)
}

// Cosa c'è in una parte finale: i gruppi che l'algoritmo ha unito, e se raccoglie gli avanzi di una cartella.
function joinedNames(u) {
  const own = u.members !== null ? u.members.flatMap(joinedNames) : [u.name]

  return [...new Set([...own, ...(u.extra ?? []).flatMap(joinedNames)])].filter(Boolean)
}

function leafOf(u) {
  const joined = joinedNames(u)

  return { name: u.name, primary: u.primary ?? u.name, files: u.files, joined: joined.length > 1 ? joined : undefined, rest: joined.length <= 1 && (u.isRest === true || u.isLoose === true) }
}

function shape(u, depthLeft, ctx, opts) {
  if (depthLeft === 0 || u.files.length <= (opts.leafMax ?? LEAF_MAX)) return leafOf(u)
  const parts = partsOf(u, ctx, opts)
  if (parts.length === 0) return leafOf(u)
  if (parts.length === 1) {
    const only = parts[0]
    if (only.members === null && (only.node !== u.node || only.skip !== u.skip)) return shape(Object.assign(only, { name: u.name }), depthLeft, ctx, opts)

    return leafOf(u)
  }
  let arranged = arrange(parts, depthLeft, ctx, opts)
  if (arranged.length === 1 && arranged[0].members !== null) {
    // tutto si è unito in un gruppo: si apre il pezzo più grande e i piccoli ci entrano
    const [big, ...others] = arranged[0].members
    const inner = partsOf(big, ctx, opts)
    if (inner.length > 1) arranged = arrange([...inner, ...others], depthLeft, ctx, opts)
  }
  if (arranged.length === 1) {
    const only = arranged[0]
    if (only.members === null && only.files.length === u.files.length && (only.node !== u.node || only.skip !== u.skip)) return shape(Object.assign(only, { name: u.name }), depthLeft, ctx, opts)

    return leafOf(u)
  }

  return { name: u.name, primary: u.primary ?? u.name, files: u.files, children: arranged.map(one => shape(one, depthLeft - 1, ctx, opts)) }
}

// ---------------------------------------------------------------- 4. i servizi esterni

const SERVICES = [
  ['MongoDB', ['mongoose', 'mongodb', '@typegoose/*', 'pymongo', 'motor', 'mongoengine']],
  ['PostgreSQL', ['pg', 'postgres', 'pg-promise', 'slonik', '@neondatabase/*', '@vercel/postgres', 'psycopg2', 'psycopg', 'asyncpg']],
  ['MySQL', ['mysql', 'mysql2', 'pymysql']],
  ['SQLite', ['sqlite3', 'better-sqlite3', 'sqlite']],
  ['Database', ['@prisma/client', 'drizzle-orm', 'typeorm', 'sequelize', 'knex', 'kysely', 'sqlalchemy']],
  ['Redis', ['redis', 'ioredis', '@upstash/redis']],
  ['Supabase', ['@supabase/*', 'supabase']],
  ['Firebase', ['firebase', 'firebase-admin', '@firebase/*', 'firebase_admin']],
  ['Stripe', ['stripe', '@stripe/*']],
  ['PayPal', ['@paypal/*', 'paypal-rest-sdk']],
  ['AWS', ['@aws-sdk/*', 'aws-sdk', 'boto3', 'botocore']],
  ['Google Cloud', ['@google-cloud/*', 'google.cloud']],
  ['Azure', ['@azure/*', 'azure']],
  ['Cloudinary', ['cloudinary']],
  ['Better Auth', ['better-auth']],
  ['Auth0', ['@auth0/*', 'auth0']],
  ['Clerk', ['@clerk/*']],
  ['Auth.js', ['next-auth', '@auth/*']],
  ['Kafka', ['kafkajs', 'node-rdkafka', 'kafka', 'confluent_kafka']],
  ['RabbitMQ', ['amqplib', 'pika']],
  ['Resend', ['resend']],
  ['SendGrid', ['@sendgrid/*', 'sendgrid']],
  ['Email', ['nodemailer']],
  ['Twilio', ['twilio']],
  ['OpenAI', ['openai']],
  ['Anthropic', ['@anthropic-ai/sdk', 'anthropic']],
  ['Google AI', ['@google/generative-ai', '@google/genai']],
  ['Sentry', ['@sentry/*', 'sentry_sdk']],
  ['PostHog', ['posthog-js', 'posthog-node', 'posthog']],
  ['Algolia', ['algoliasearch']],
  ['Elasticsearch', ['@elastic/elasticsearch', 'elasticsearch']],
  ['Pusher', ['pusher', 'pusher-js']],
  ['Celery', ['celery']],
]

// Servizi noti raggiunti con un indirizzo invece che con una libreria.
const KNOWN_HOSTS = [
  ['Gemini', /(^|\.)generativelanguage\.googleapis\.com$/],
  ['Vertex AI', /(^|\.)aiplatform\.googleapis\.com$/],
  ['OpenAI', /(^|\.)api\.openai\.com$/],
  ['Anthropic', /(^|\.)api\.anthropic\.com$/],
  ['OpenRouter', /(^|\.)openrouter\.ai$/],
  ['Mistral', /(^|\.)api\.mistral\.ai$/],
  ['Groq', /(^|\.)api\.groq\.com$/],
  ['Stripe', /(^|\.)api\.stripe\.com$/],
  ['Resend', /(^|\.)api\.resend\.com$/],
  ['SendGrid', /(^|\.)api\.sendgrid\.com$/],
  ['Slack', /(^|\.)(hooks\.)?slack\.com$/],
  ['Telegram', /(^|\.)api\.telegram\.org$/],
  ['Twilio', /(^|\.)api\.twilio\.com$/],
  ['Microsoft Graph', /(^|\.)graph\.microsoft\.com$/],
  ['Google Maps', /(^|\.)maps\.googleapis\.com$/],
  ['Mapbox', /(^|\.)api\.mapbox\.com$/],
  ['Supabase', /\.supabase\.co$/],
  ['Cloudflare R2', /\.r2\.cloudflarestorage\.com$/],
  ['AWS', /\.amazonaws\.com$/],
  ['Cloudinary', /(^|\.)api\.cloudinary\.com$/],
]
// Una variabile d'ambiente che porta a un altro servizio dello stesso prodotto (PAYMENTS_SERVICE_URL).
const SERVICE_ENV = /^(?:(?:NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP)_)?([A-Z0-9_]*?)_?(SERVICE|SERVICES|WS|WEBSERVICE|MICROSERVICE|BACKEND|API)_(?:BASE_)?(?:URL|URI|HOST|ENDPOINT)$/

// Variabili che puntano all'app stessa o al suo database (già trovato dalla libreria): non sono servizi da aggiungere.
const SELF_ENV = /(^|_)(APP|BASE|SITE|PUBLIC|FRONTEND|WEB|CLIENT|CALLBACK|REDIRECT|AUTH|VERCEL|HOST)_(URL|URI|HOST)$|^(DATABASE|MONGO|MONGODB|POSTGRES|PG|MYSQL|REDIS|DB|SQL|SQLITE)_(URL|URI|HOST)$/

function externalsOf(files, opts, hasOwnApi) {
  const product = files.filter(file => !['tests', 'tooling', 'docs'].includes(file.role))
  const found = new Map()
  const entry = name => {
    if (!found.has(name)) found.set(name, { name, packages: [], reach: new Set(), users: new Set(), seen: new Set() })

    return found.get(name)
  }
  for (const [name, patterns] of SERVICES) {
    const matches = pkg => patterns.some(pattern => (pattern.endsWith('*') ? pkg.startsWith(pattern.slice(0, -1)) : pkg === pattern))
    const users = files.filter(file => file.externals.some(matches))
    if (users.length === 0) continue
    const one = entry(name)
    one.packages = patterns
    for (const file of users) {
      one.users.add(file.path)
      for (const pkg of file.externals.filter(matches)) one.seen.add(pkg)
    }
  }
  // indirizzi: servizi noti, e altri servizi del prodotto chiamati con una variabile d'ambiente
  const addresses = new Map()
  for (const file of product) for (const one of file.reach ?? []) addresses.set(one, [...(addresses.get(one) ?? []), file.path])
  const leftover = []
  const later = []
  for (const [address, users] of addresses) {
    if (SELF_ENV.test(address)) continue
    let name = KNOWN_HOSTS.find(([, test]) => test.test(address))?.[0]
    const env = SERVICE_ENV.exec(address)
    if (name === undefined && env !== null) {
      const prefix = env[1].replace(/_+$/, '')
      if (prefix === '' && hasOwnApi) {
        leftover.push({ address, users })
        continue
      }
      name = prefix === '' ? opts.words.backend : opts.words.service(humanize(prefix.toLowerCase().replace(/_/g, ' ')))
    }
    if (name === undefined) {
      later.push({ address, users })
      continue
    }
    const one = entry(name)
    one.reach.add(address)
    for (const path of users) one.users.add(path)
    one.seen.add(address)
  }
  // OPENROUTER_BASE_URL va a OpenRouter: la variabile porta il nome di un servizio già trovato
  for (const item of later) {
    const head = item.address.split('_')[0].toLowerCase()
    const one = /^[A-Z0-9_]+$/.test(item.address) ? [...found.values()].find(service => slug(service.name).split('-')[0] === head) : undefined
    if (one === undefined) {
      leftover.push(item)
      continue
    }
    one.reach.add(item.address)
    for (const path of item.users) one.users.add(path)
  }
  const used = [...found.values()].sort((a, b) => b.users.size - a.users.size || (a.name < b.name ? -1 : 1))
  const nodes = used.slice(0, MAX_EXTERNAL).map(one => {
    const node = {
      id: slug(one.name),
      name: one.name,
      kind: 'external',
      summary: `${opts.words.uses} ${one.users.size} ${opts.words.files} (${[...one.seen].slice(0, 3).join(', ')})`,
      packages: one.packages,
      auto: true,
    }
    if (one.reach.size > 0) node.reach = [...one.reach].sort()

    return node
  })

  return { nodes, leftover: leftover.sort((a, b) => b.users.length - a.users.length || (a.address < b.address ? -1 : 1)) }
}

// ---------------------------------------------------------------- 5. i percorsi della mappa

function patternsFor(leaves, files) {
  const owner = new Map()
  for (const leaf of leaves) for (const file of leaf.files) owner.set(file.path, leaf)
  const under = new Map()
  for (const file of files) {
    if (!owner.has(file.path)) continue
    for (let folder = folderOf(file.path); folder !== ''; folder = parentFolder(folder)) under.set(folder, [...(under.get(folder) ?? []), file.path])
  }
  const pure = new Map()
  for (const [folder, list] of under) {
    const first = owner.get(list[0])
    if (list.every(path => owner.get(path) === first)) pure.set(folder, first)
  }
  for (const leaf of leaves) leaf.paths = []
  const covered = new Set()
  // le cartelle che appartengono tutte a una parte
  for (const [folder, leaf] of [...pure].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const parent = parentFolder(folder)
    if (parent !== '' && pure.get(parent) === leaf) continue
    leaf.paths.push(folder)
    for (const path of under.get(folder)) covered.add(path)
  }
  // nelle cartelle miste: un prefisso comune ("lib/services/expense*"), se non prende file altrui
  const direct = new Map()
  for (const file of files) if (owner.has(file.path)) direct.set(folderOf(file.path), [...(direct.get(folderOf(file.path)) ?? []), file.path])
  for (const leaf of leaves) {
    const byFolder = new Map()
    for (const file of leaf.files) if (!covered.has(file.path)) byFolder.set(folderOf(file.path), [...(byFolder.get(folderOf(file.path)) ?? []), file.path])
    for (const [folder, list] of byFolder) {
      const prefixes = new Map()
      for (const path of list) {
        const first = /^[A-Za-z0-9]+?(?=[-_.]|[A-Z]|$)/.exec(baseName(path))?.[0]
        if (first !== undefined && first.length >= 3) prefixes.set(first, (prefixes.get(first) ?? 0) + 1)
      }
      for (const [prefix, n] of prefixes) {
        if (n < 2) continue
        const hits = (direct.get(folder) ?? []).filter(path => baseName(path).startsWith(prefix))
        if (hits.every(path => owner.get(path) === leaf)) {
          leaf.paths.push(`${folder}${prefix}*`)
          for (const path of hits) covered.add(path)
        }
      }
    }
  }
  // la cartella mista va alla parte che ne ha più file: così i file nuovi trovano casa
  for (const [folder, list] of direct) {
    if (folder === '' || pure.has(folder)) continue
    const counts = new Map()
    for (const path of list) counts.set(owner.get(path), (counts.get(owner.get(path)) ?? 0) + 1)
    const [leaf] = [...counts].sort((a, b) => b[1] - a[1])[0]
    leaf.paths.push(folder)
  }
  // controllo finale: dove le regole sbagliano, il file si scrive per intero
  for (let round = 0; round < 3; round += 1) {
    const matchers = leaves.flatMap((leaf, order) => leaf.paths.map(raw => ({ leaf, order, test: compilePattern(raw) })))
    let fixed = 0
    for (const file of files) {
      const want = owner.get(file.path)
      if (want === undefined) continue
      let best
      for (const matcher of matchers) {
        const hit = matcher.test(file.path)
        if (hit === undefined) continue
        if (best === undefined || hit.tier > best.tier || (hit.tier === best.tier && (hit.score > best.score || (hit.score === best.score && matcher.order < best.order)))) {
          best = { ...hit, order: matcher.order, leaf: matcher.leaf }
        }
      }
      if (best?.leaf !== want) {
        want.paths.push(file.path)
        fixed += 1
      }
    }
    if (fixed === 0) break
  }
  for (const leaf of leaves) leaf.paths = [...new Set(leaf.paths)]
}

// ---------------------------------------------------------------- la bozza

function commonFolder(files) {
  let common = folderOf(files[0].path)
  for (const file of files) while (common !== '' && !file.path.startsWith(common)) common = parentFolder(common)

  return common
}

export function draftMap(scan, options = {}) {
  const lang = options.lang === 'it' ? 'it' : 'en'
  const opts = { lang, words: WORDS[lang] }
  unitCount = 0
  const files = scan.files
  const byPath = new Map(files.map(file => [file.path, file]))
  const roots = findRouteRoots(scan)
  const roles = new Map(files.map(file => [file.path, roleOf(file, roots)]))
  voteRoles(files, roles, byPath)
  const co = options.coChange ?? gitCoChange(scan.root, new Set(byPath.keys()))
  const ctx = makeContext(scan, co)

  // i blocchi: uno per strato; quelli quasi vuoti si uniscono alla logica
  const groups = new Map()
  for (const file of files) {
    const role = roles.get(file.path)
    groups.set(role.block, [...(groups.get(role.block) ?? []), { file, segs: role.segs }])
  }
  if ((groups.get('docs')?.length ?? 0) < 15 && groups.has('docs')) {
    groups.set('tooling', [...(groups.get('tooling') ?? []), ...groups.get('docs')])
    groups.delete('docs')
  }
  for (const key of [...groups.keys()]) {
    if (groups.get(key).length >= PART_MIN || groups.size <= 2) continue
    const into = ['logic', 'shared', 'ui', 'pages'].find(other => other !== key && groups.has(other)) ?? [...groups.keys()].find(other => other !== key)
    groups.set(into, [...groups.get(into), ...groups.get(key)])
    groups.delete(key)
  }

  const blocks = []
  for (const key of ORDER) {
    const entries = groups.get(key)
    if (entries === undefined) continue
    const isRoute = key === 'pages' || entries.some(entry => entry.segs !== undefined)
    // fuori dalle rotte, l'albero è quello delle cartelle, senza la parte comune a tutto il blocco
    const plain = entries.filter(entry => entry.segs === undefined)
    const common = plain.length > 0 ? commonFolder(plain.map(entry => entry.file)) : ''
    const tree = treeOf(entries.map(entry => ({ file: entry.file, segs: entry.segs ?? entry.file.path.slice(common.length).split('/').slice(0, -1) })))
    const name = key === 'ui' && !groups.has('pages') ? opts.words.interface : BLOCKS[key][lang]
    const root = nodeUnit(tree, name, { isBlock: true, routeLike: isRoute })
    const shaped = shape(root, 2, ctx, { ...opts, leafMax: key === 'tooling' || key === 'docs' ? 2 * LEAF_MAX : LEAF_MAX })
    blocks.push({ key, kind: BLOCKS[key].kind, shaped })
  }

  // ids leggibili e stabili: il blocco, poi i nomi delle parti
  const used = new Set()
  const unique = base => {
    let id = base
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`
    used.add(id)

    return id
  }
  const leaves = []
  const where = files => {
    const folder = commonFolder(files)

    return folder === '' ? '(root)' : folder
  }
  const toNode = (shaped, kind, id) => {
    const node = { id, name: shaped.name, kind, summary: `${shaped.files.length} ${opts.words.files} · ${where(shaped.files)}`, auto: true }
    if (shaped.children !== undefined) {
      node.children = shaped.children
        .sort((a, b) => b.files.length - a.files.length || (a.name < b.name ? -1 : 1))
        .map(child => toNode(child, kind, unique(`${id}-${slug(child.primary ?? child.name)}`)))
    } else {
      const leaf = { node, files: shaped.files }
      leaves.push(leaf)
    }
    if (shaped.joined !== undefined) node.members = shaped.joined
    if (shaped.rest) node.rest = true

    return node
  }
  const nodes = blocks.map(block => toNode(block.shaped, block.kind, unique(block.key)))
  // l'ordine in cui render legge i blocchi decide i pareggi tra percorsi: lo stesso qui
  const order = []
  const walk = list => {
    for (const node of list) {
      const leaf = leaves.find(one => one.node === node)
      if (leaf !== undefined) order.push(leaf)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  patternsFor(order, files)
  for (const leaf of order) leaf.node.paths = leaf.paths
  for (const file of files) file.role = roles.get(file.path).block
  const { nodes: externals, leftover } = externalsOf(files, opts, groups.has('api'))

  return {
    generator: GENERATOR,
    fingerprint: fingerprintOf(scan),
    title: scan.name,
    lang,
    summary: '',
    nodes: [...nodes, ...externals],
    links: [],
    // indirizzi chiamati dal codice che non sono un servizio noto: Claude decide se lo sono
    addresses: leftover.slice(0, 12).map(one => ({ address: one.address, files: one.users.length, sample: one.users.slice(0, 3) })),
  }
}

// ---------------------------------------------------------------- è cambiato qualcosa?

// L'impronta del codice: i file che Pharos legge e il loro contenuto, più la versione
// dell'algoritmo. Se non cambia, la mappa di prima è ancora giusta.
export function fingerprintOf(scan) {
  const hash = createHash('sha1')
  hash.update(GENERATOR)
  for (const file of scan.files) {
    hash.update(`\n${file.path}\0`)
    hash.update(scan.texts?.get(file.path) ?? String(file.size))
  }

  return hash.digest('hex').slice(0, 16)
}

const mtime = path => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// Cosa serve fare per mostrare la mappa: niente da rifare, solo ridisegnare, aggiornarla o farla.
export function mapStatus(root, scan, mapPath = join(root, '.pharos', 'map.json')) {
  if (!existsSync(mapPath)) return { state: 'none' }
  let map
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8'))
  } catch {
    return { state: 'none' }
  }
  const dir = dirname(mapPath)
  const page = join(dir, 'map.html')
  const pageIsOld = mtime(page) < Math.max(mtime(mapPath), mtime(join(dir, 'names.json')))
  if (map.generator === undefined) return { state: 'hand', pageIsOld }
  if (map.fingerprint !== fingerprintOf(scan)) return { state: 'changed', hasNames: existsSync(join(dir, 'names.json')) }

  return { state: pageIsOld ? 'render' : 'fresh' }
}

// ---------------------------------------------------------------- la panoramica per Claude

// Chi possiede ogni file secondo i percorsi della mappa, con le stesse regole di render.mjs.
export function ownership(map, scan) {
  const flat = []
  const matchers = []
  const walk = (list, depth, top) => {
    for (const node of list) {
      flat.push({ node, depth, top: top ?? node.id })
      if (node.paths) for (const raw of node.paths) matchers.push({ id: node.id, order: matchers.length, test: compilePattern(raw) })
      if (node.children) walk(node.children, depth + 1, top ?? node.id)
    }
  }
  walk(map.nodes, 0, null)
  const owner = new Map()
  const filesOf = new Map()
  for (const file of scan.files) {
    let best
    for (const matcher of matchers) {
      const hit = matcher.test(file.path)
      if (hit !== undefined && (best === undefined || hit.tier > best.tier || (hit.tier === best.tier && hit.score > best.score))) best = { ...hit, id: matcher.id }
    }
    if (best === undefined) continue
    owner.set(file.path, best.id)
    filesOf.set(best.id, [...(filesOf.get(best.id) ?? []), file])
  }

  return { flat, owner, filesOf }
}

const GENERIC = /^(page|route|layout|index|loading|error|default|template|not-found|global-error|head|_app|_document|\+page|\+layout|\+server)(\.[^.]+)+$/

// Cosa c'è in una parte, in una riga: le sottocartelle e i nomi di file che dicono qualcosa.
// Se quasi tutto sta in una sola sottocartella (projects/[id]/…) si scende fino a dove si divide.
function contents(list) {
  const folder = commonFolder(list)
  const rels = list.map(file => file.path.slice(folder.length))
  let inner = ''
  for (;;) {
    const next = new Map()
    for (const rel of rels) {
      if (!rel.startsWith(inner)) continue
      const rest = rel.slice(inner.length)
      if (rest.includes('/')) next.set(rest.slice(0, rest.indexOf('/') + 1), (next.get(rest.slice(0, rest.indexOf('/') + 1)) ?? 0) + 1)
    }
    const top = [...next].sort((a, b) => b[1] - a[1])[0]
    if (top === undefined || top[1] < 0.75 * rels.length) break
    inner += top[0]
  }
  const subs = new Map()
  const loose = []
  list.forEach((file, i) => {
    const rel = rels[i]
    const rest = rel.startsWith(inner) ? rel.slice(inner.length) : rel
    if (rest.includes('/')) subs.set(rest.slice(0, rest.indexOf('/') + 1), (subs.get(rest.slice(0, rest.indexOf('/') + 1)) ?? 0) + 1)
    else loose.push(file)
  })
  const telling = loose.filter(file => !GENERIC.test(baseName(file.path)))
  const names = (telling.length > 0 ? telling : loose).sort((a, b) => b.importedBy - a.importedBy || b.loc - a.loc).map(file => baseName(file.path))
  const shown = [...subs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sub, n]) => `${sub} ${n}`)
  const more = names.slice(0, Math.max(2, 5 - shown.length))
  const where = `${folder}${inner}` === '' ? '(root)' : `${folder}${inner}`

  return `${where} · ${[...shown, ...more].join(', ')}${subs.size > 5 || names.length > more.length ? ', …' : ''}`
}

export function draftOutline(map, scan, out) {
  const lines = []
  const { flat, owner, filesOf } = ownership(map, scan)
  const topOf = new Map(flat.map(({ node, top }) => [node.id, top]))
  const internal = map.nodes.filter(node => node.kind !== 'external').length
  const parts = flat.filter(one => one.depth > 0).length
  lines.push(`# Pharos draft: ${map.title}`)
  lines.push(`${scan.files.length} files → ${internal} blocks, ${parts} parts, ${owner.size}/${scan.files.length} files placed. Wrote ${out}`)
  const callers = scan.files.filter(file => file.calls?.length > 0).length
  if (callers > 0) lines.push(`${callers} files call the project's own API by address; those arrows are drawn too.`)
  lines.push('')
  lines.push('## Blocks and parts')
  lines.push('id · automatic name · files · folder · its subfolders (with files) and telling file names')
  lines.push('"joins: A | B" = groups the algorithm joined; "leftovers" = the files of a folder no other part took (mixed: read them before naming)')
  lines.push('To see every file of a part: node <skill>/scripts/draft.mjs <root> --part <id>')
  const below = node => (node.children ? node.children.flatMap(below) : (filesOf.get(node.id) ?? []))
  for (const { node, depth } of flat) {
    if (node.kind === 'external') continue
    const list = below(node)
    const tail = node.children ? '  (opens)' : ''
    const marks = [node.members ? `joins: ${node.members.join(' | ')}` : '', node.rest ? 'leftovers' : ''].filter(Boolean)
    lines.push(`${'  '.repeat(depth)}${node.id} · ${node.name} · ${list.length} · ${list.length > 0 ? contents(list) : '-'}${tail}${marks.length > 0 ? `  [${marks.join('; ')}]` : ''}`)
  }
  const externals = map.nodes.filter(node => node.kind === 'external')
  if (externals.length > 0) {
    lines.push('', '## Outside services  (found from the packages the code imports and from known addresses it calls)')
    for (const node of externals) lines.push(`${node.id} · ${node.name} · ${node.summary}`)
  }
  if (Array.isArray(map.addresses) && map.addresses.length > 0) {
    lines.push('', '## Addresses the code calls that are not a known service  (maybe outside services: add them in names.json "services" with "reach")')
    for (const one of map.addresses) {
      const where = [...new Set(one.sample.map(path => owner.get(path)).filter(Boolean))]
      lines.push(`${one.address} · ${one.files} ${one.files === 1 ? 'file' : 'files'} · in ${where.join(', ')} · e.g. ${one.sample[0]}`)
    }
  }
  const arrows = new Map()
  const add = (from, to) => {
    if (from === undefined || to === undefined || from === to) return
    arrows.set(`${from} → ${to}`, (arrows.get(`${from} → ${to}`) ?? 0) + 1)
  }
  for (const file of scan.files) {
    const from = topOf.get(owner.get(file.path))
    for (const target of new Set([...file.imports, ...(file.calls ?? [])])) add(from, topOf.get(owner.get(target)))
    for (const node of externals) {
      const matches = pkg => node.packages.some(pattern => (pattern.endsWith('*') ? pkg.startsWith(pattern.slice(0, -1)) : pkg === pattern))
      if (file.externals.some(matches) || (file.reach ?? []).some(one => node.reach?.includes(one))) add(from, node.id)
    }
  }
  if (arrows.size > 0) {
    lines.push('', '## Strongest arrows between blocks  (how many file links)')
    lines.push(
      [...arrows]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([key, n]) => `${key} ${n}`)
        .join(', '),
    )
  }

  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const flag = name => {
    const at = args.indexOf(name)

    return at === -1 ? undefined : args[at + 1]
  }
  const root = resolve(args.find((arg, at) => !arg.startsWith('--') && !['--lang', '--out', '--part'].includes(args[at - 1])) ?? process.cwd())
  const scan = scanProject(root)
  if (scan.files.length === 0) {
    console.error(`Pharos: no source files found in ${root}.`)
    process.exit(1)
  }
  const out = resolve(flag('--out') ?? join(root, '.pharos', 'map.json'))
  if (args.includes('--check')) {
    // una riga che dice cosa fare: la prima parola la legge Claude
    const status = mapStatus(root, scan, out)
    const say = {
      none: 'none — there is no map yet: make it (draft, names, render).',
      hand: 'hand — a hand-written map: draw it with render.mjs, the draft leaves it alone.',
      changed: `changed — the code changed since the last map: run the draft again, name only the new parts, then render.${status.hasNames ? '' : ' (no names.json yet)'}`,
      render: 'render — the code did not change but the page is older than the map or the names: run render.mjs.',
      fresh: 'fresh — the map is up to date: just open it with render.mjs --open.',
    }
    console.log(say[status.state])

    return
  }
  const part = flag('--part')
  if (part !== undefined) {
    // tutti i file di una parte della bozza già scritta, per capire cosa c'è dentro
    if (!existsSync(out)) {
      console.error(`Pharos: no map at ${out}. Run the draft first.`)
      process.exit(1)
    }
    const map = JSON.parse(readFileSync(out, 'utf8'))
    const { flat, filesOf } = ownership(map, scan)
    const found = flat.find(one => one.node.id === part)
    if (found === undefined) {
      console.error(`Pharos: no part "${part}" in ${out}.`)
      process.exit(1)
    }
    const below = node => (node.children ? node.children.flatMap(below) : (filesOf.get(node.id) ?? []).map(file => ({ file, id: node.id })))
    console.log(`Files of "${part}" in the draft (before the moves in names.json):`)
    for (const { file, id } of below(found.node)) {
      console.log(`${file.path}  ${file.loc} lines${id !== part ? `  (${id})` : ''}${file.about ? `  — ${file.about}` : ''}`)
    }

    return
  }
  let previous
  if (existsSync(out) && !args.includes('--force') && !args.includes('--json')) {
    try {
      const old = JSON.parse(readFileSync(out, 'utf8'))
      previous = old
      if (old.generator === undefined) {
        console.error(`Pharos: ${out} was written by hand, so the draft leaves it alone. Run render.mjs to redraw it, or pass --force to replace it.`)
        process.exit(1)
      }
    } catch {
      // un file rotto si può sostituire
    }
  }
  // aggiornando, la lingua resta quella della mappa di prima
  const map = draftMap(scan, { lang: flag('--lang') ?? previous?.lang })
  if (args.includes('--json')) {
    console.log(JSON.stringify(map, null, 1))

    return
  }
  mkdirSync(dirname(out), { recursive: true })
  if (!flag('--out')) writeFileSync(join(dirname(out), '.gitignore'), '*\n')
  writeFileSync(out, `${JSON.stringify(map, null, 1)}\n`)
  console.log(draftOutline(map, scan, out))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
