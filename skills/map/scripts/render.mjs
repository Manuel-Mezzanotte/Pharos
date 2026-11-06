#!/usr/bin/env node
// Il renderer di Pharos: prende la mappa scritta da Claude (.pharos/map.json), la
// confronta con il codice vero (import tra i file), la controlla e scrive la
// pagina .pharos/map.html, che poi apre nel browser.
//
//   node render.mjs [cartella-del-progetto] [--spec file] [--out file] [--no-open]

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanProject } from './scan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(here, '..', 'assets')
const layout = createRequire(import.meta.url)(join(ASSETS, 'layout.js'))

// Nomi che dicono "tutto il resto" invece di un argomento: chi legge non ci capisce niente.
const CATCH_ALL = /^(altr[aeio]|other|others|misc|miscellaneous|vari[ae]?|resto|rest|everything else|tutto il resto)(\s|$)/i

export const KINDS = ['interface', 'api', 'logic', 'data', 'external', 'shared', 'tooling', 'test', 'docs', 'other']
const ID = /^[\w.:-]+$/

function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'block'
  )
}

const text = value => (typeof value === 'string' ? value.trim() : '')
const strings = value => (Array.isArray(value) ? value.filter(one => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : [])

// ---------------------------------------------------------------- i percorsi di un blocco

// Un percorso può essere un file esatto, una cartella ("src/api/") o un glob.
// Senza barra, un glob vale in ogni cartella ("*.test.ts"); con la barra parte
// dalla radice ("src/**/*.ts"), a meno che non cominci con "**/".
// L'esatto batte il glob, il glob batte la cartella; a parità vince il più lungo.
function globSource(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 1
        if (pattern[i + 1] === '/') {
          i += 1
          out += '(?:.*/)?'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return out
}

export function compilePattern(raw) {
  let pattern = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!/[*?]/.test(pattern)) {
    const dir = pattern.replace(/\/+$/, '')
    const endsWithSlash = pattern.endsWith('/')

    return path => {
      if (!endsWithSlash && path === dir) return { tier: 3, score: dir.length }
      if (path.startsWith(`${dir}/`)) return { tier: 1, score: dir.length }

      return undefined
    }
  }
  if (pattern.endsWith('/')) pattern += '**'
  const literal = pattern.replace(/[*?]/g, '').length
  const regex = new RegExp(`^${globSource(pattern)}$`)
  if (!pattern.includes('/')) {
    return path => (regex.test(path.slice(path.lastIndexOf('/') + 1)) ? { tier: 2, score: literal } : undefined)
  }

  return path => (regex.test(path) ? { tier: 2, score: literal } : undefined)
}

// ---------------------------------------------------------------- la mappa -> i dati della pagina

function flatten(list, parent, out, ctx) {
  const ids = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) {
      ctx.warnings.push('A node is not an object: skipped.')
      continue
    }
    const name = text(raw.name)
    if (name === '') {
      ctx.errors.push(`A node${raw.id ? ` ("${raw.id}")` : ''} has no "name".`)
      continue
    }
    let id = text(raw.id) !== '' ? text(raw.id) : slug(name)
    if (!ID.test(id)) {
      ctx.warnings.push(`Node id "${id}" has unusual characters; using "${slug(id)}".`)
      id = slug(id)
    }
    if (ctx.ids.has(id)) {
      if (text(raw.id) !== '') {
        ctx.errors.push(`Two nodes share the id "${id}".`)
        continue
      }
      let n = 2
      while (ctx.ids.has(`${id}-${n}`)) n += 1
      id = `${id}-${n}`
    }
    ctx.ids.add(id)
    const packages = strings(raw.packages)
    let kind = raw.kind
    if (!KINDS.includes(kind)) {
      if (kind !== undefined) ctx.warnings.push(`Node "${id}": unknown kind "${kind}" (use ${KINDS.join(', ')}); using "other".`)
      kind = packages.length > 0 ? 'external' : 'other'
    }
    const node = {
      id,
      name,
      kind,
      summary: text(raw.summary),
      about: text(raw.about),
      parent,
      children: [],
      external: kind === 'external',
      paths: strings(raw.paths),
      packages,
      reach: strings(raw.reach),
      auto: raw.auto === true,
    }
    ctx.byRef.set(id, id)
    ctx.byRef.set(slug(name), ctx.byRef.get(slug(name)) ?? id)
    out.push(node)
    ids.push(id)
    if (Array.isArray(raw.children) && raw.children.length > 0) node.children = flatten(raw.children, id, out, ctx)
  }

  return ids
}

function packageMatcher(patterns) {
  return name => patterns.some(pattern => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern))
}

export function buildData(spec, scan) {
  const ctx = { warnings: [], errors: [], notes: [], ids: new Set(), byRef: new Map() }
  if (typeof spec !== 'object' || spec === null || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    ctx.errors.push('The map needs a non-empty "nodes" array.')

    return { ...ctx, data: undefined }
  }
  const nodes = []
  const roots = flatten(spec.nodes, null, nodes, ctx)
  if (ctx.errors.length > 0) return { ...ctx, data: undefined }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const ref = value => {
    const key = text(value)

    return byId.has(key) ? key : (ctx.byRef.get(slug(key)) ?? [...byId.values()].find(node => node.name.toLowerCase() === key.toLowerCase())?.id)
  }
  const chain = id => {
    const out = []
    for (let at = id; at !== null && at !== undefined; at = byId.get(at).parent) out.push(at)

    return out
  }
  const subtree = id => {
    const out = new Set([id])
    for (const child of byId.get(id).children) for (const one of subtree(child)) out.add(one)

    return out
  }
  const isUnder = (ancestor, id) => ancestor !== id && chain(id).includes(ancestor)

  // 1. ogni file va al blocco con il percorso più preciso
  const matchers = nodes.flatMap((node, order) => node.paths.map(raw => ({ id: node.id, raw, order, test: compilePattern(raw), hits: 0 })))
  const ownerOf = new Map()
  for (const file of scan.files) {
    let best
    for (const matcher of matchers) {
      const hit = matcher.test(file.path)
      if (hit === undefined) continue
      matcher.hits += 1
      if (best === undefined || hit.tier > best.tier || (hit.tier === best.tier && (hit.score > best.score || (hit.score === best.score && matcher.order < best.order)))) {
        best = { ...hit, order: matcher.order, id: matcher.id }
      }
    }
    if (best !== undefined) ownerOf.set(file.path, best.id)
  }
  const filesOf = new Map(nodes.map(node => [node.id, []]))
  for (const file of scan.files) {
    const owner = ownerOf.get(file.path)
    if (owner !== undefined) filesOf.get(owner).push(file)
  }
  const stats = new Map()
  const under = new Map()
  for (const node of nodes) {
    const list = [...subtree(node.id)].flatMap(id => filesOf.get(id))
    under.set(node.id, list)
    stats.set(node.id, { files: list.length, loc: list.reduce((sum, file) => sum + file.loc, 0) })
  }

  // 2. i collegamenti che il codice mostra: un file importa un altro file di un altro blocco
  const hasKindAbove = (id, kind) => chain(id).some(one => byId.get(one).kind === kind)
  const derived = new Map()
  for (const file of scan.files) {
    const from = ownerOf.get(file.path)
    if (from === undefined) continue
    for (const target of new Set([...file.imports, ...(file.calls ?? [])])) {
      const to = ownerOf.get(target)
      if (to === undefined || to === from || isUnder(from, to) || isUnder(to, from)) continue
      const key = `${from}>${to}`
      const edge = derived.get(key) ?? { a: from, b: to, w: 0, label: '', declared: false, soft: hasKindAbove(to, 'shared') || hasKindAbove(from, 'test') || hasKindAbove(from, 'tooling') }
      edge.w += 1
      derived.set(key, edge)
    }
  }

  // ...e quelli verso i pacchetti esterni dichiarati nei blocchi "external"
  const usedBy = new Map()
  const seenPackages = new Map()
  for (const node of nodes) {
    if (node.packages.length === 0 && node.reach.length === 0) continue
    const matches = packageMatcher(node.packages)
    const reach = new Set(node.reach)
    const files = new Set()
    for (const file of scan.files) {
      const from = ownerOf.get(file.path)
      // un servizio si raggiunge con una libreria o con un indirizzo (host, variabile d'ambiente)
      for (const name of [...file.externals.filter(matches), ...(file.reach ?? []).filter(one => reach.has(one))]) {
        files.add(file.path)
        const seen = seenPackages.get(node.id) ?? new Map()
        seen.set(name, (seen.get(name) ?? 0) + 1)
        seenPackages.set(node.id, seen)
        if (from === undefined || from === node.id || isUnder(from, node.id) || isUnder(node.id, from)) continue
        const key = `${from}>${node.id}`
        const edge = derived.get(key) ?? { a: from, b: node.id, w: 0, label: '', declared: false, soft: hasKindAbove(from, 'test') || hasKindAbove(from, 'tooling') }
        edge.w += 1
        derived.set(key, edge)
      }
    }
    usedBy.set(node.id, files.size)
    if (files.size === 0 && node.external) ctx.notes.push(`"${node.name}": none of its packages or addresses (${[...node.packages, ...node.reach].join(', ')}) are used by the files in the blocks.`)
  }

  // 3. i collegamenti scritti da Claude: danno il nome a quelli del codice, oppure restano da soli
  const declared = []
  for (const link of Array.isArray(spec.links) ? spec.links : []) {
    const from = ref(link?.from)
    const to = ref(link?.to)
    if (from === undefined || to === undefined) {
      ctx.warnings.push(`Link ${JSON.stringify(link?.from)} → ${JSON.stringify(link?.to)} skipped: unknown block id.`)
      continue
    }
    if (from === to || isUnder(from, to) || isUnder(to, from)) {
      ctx.warnings.push(`Link "${from}" → "${to}" skipped: a block cannot link to itself or to its own parts.`)
      continue
    }
    declared.push({ from, to, label: text(link.label), a: subtree(from), b: subtree(to) })
  }
  declared.sort((x, y) => x.a.size + x.b.size - (y.a.size + y.b.size))
  const edges = [...derived.values()]
  const linkStats = { named: 0, added: 0, addedList: [] }
  for (const link of declared) {
    const covered = edges.filter(edge => !edge.declared && link.a.has(edge.a) && link.b.has(edge.b))
    // il nome vale per tutte le frecce tra le parti dei due blocchi, ma ognuna ricorda
    // a che livello è stato dato (lf, lt): si vede sempre solo a quel livello
    if (covered.length > 0) {
      linkStats.named += 1
      if (link.label !== '') {
        for (const edge of covered) {
          if (edge.label !== '') continue
          edge.label = link.label
          edge.lf = link.from
          edge.lt = link.to
        }
      }
    } else {
      linkStats.added += 1
      linkStats.addedList.push(`${link.from} → ${link.to}`)
      const same = edges.find(edge => edge.a === link.from && edge.b === link.to)
      if (same === undefined) edges.push({ a: link.from, b: link.to, w: 1, label: link.label, lf: link.from, lt: link.to, declared: true, soft: false })
      else if (same.label === '') Object.assign(same, { label: link.label, lf: link.from, lt: link.to })
    }
  }

  // 4. i file di ogni blocco, per il pannello: solo quelli messi in un blocco,
  //    con quello che serve per capirli (righe, cosa offrono, chi li usa, quando cambiano)
  const placed = scan.files.filter(file => ownerOf.has(file.path))
  const indexOf = new Map(placed.map((file, i) => [file.path, i]))
  const activity = id => {
    let last = 0
    let recent = 0
    for (const file of under.get(id)) {
      last = Math.max(last, file.last ?? 0)
      recent += file.recent ?? 0
    }

    return { last, recent }
  }

  const data = {
    title: text(spec.title) || scan.name,
    summary: text(spec.summary),
    lang: text(spec.lang) === 'it' ? 'it' : 'en',
    generated: new Date().toISOString(),
    roots,
    nodes: nodes.map(node => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      summary: node.summary,
      about: node.about,
      parent: node.parent,
      children: node.children,
      external: node.external,
      files: stats.get(node.id).files,
      loc: stats.get(node.id).loc,
      own: filesOf.get(node.id).map(file => indexOf.get(file.path)),
      ...activity(node.id),
      packages: node.packages.length > 0 ? [...(seenPackages.get(node.id) ?? [])].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name]) => name) : [],
      usedBy: usedBy.get(node.id) ?? 0,
    })),
    files: placed.map(file => ({
      p: file.path,
      n: ownerOf.get(file.path),
      loc: file.loc,
      by: file.importedBy,
      ...(file.exports.length > 0 ? { ex: file.exports } : {}),
      ...(file.about !== undefined ? { d: file.about } : {}),
      ...(file.last !== undefined ? { t: file.last, c: file.recent } : {}),
      ...(file.externals.length > 0 ? { pk: file.externals } : {}),
      im: [...new Set([...file.imports, ...(file.calls ?? [])])].map(target => indexOf.get(target)).filter(index => index !== undefined),
    })),
    edges: edges.map(edge => ({
      a: edge.a,
      b: edge.b,
      w: edge.w,
      label: edge.label,
      ...(edge.label !== '' ? { lf: edge.lf, lt: edge.lt } : {}),
      declared: edge.declared,
      soft: edge.soft,
    })),
  }

  // 5. i controlli: tutto quello che Claude deve ancora sistemare
  const unassigned = scan.files.filter(file => !ownerOf.has(file.path))
  if (unassigned.length > 0) {
    const share = Math.round((unassigned.length / scan.files.length) * 100)
    const dirs = new Map()
    for (const file of unassigned) {
      const folders = file.path.split('/').slice(0, -1).slice(0, 2)
      const dir = folders.length > 0 ? `${folders.join('/')}/` : '(root)'
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    }
    const where = [...dirs].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([dir, n]) => `${dir} (${n})`).join(', ')
    const message = `${unassigned.length} of ${scan.files.length} files (${share}%) are in no block; most are in ${where}.`
    if (share >= 4) ctx.warnings.push(`${message} Add their paths to a block (or a new one).`)
    else ctx.notes.push(message)
  }
  for (const matcher of matchers) {
    if (matcher.hits === 0) {
      ctx.warnings.push(`Path "${matcher.raw}" of block "${matcher.id}" matches no file Pharos reads (wrong path, ignored by git, or not source code).`)
    }
  }
  for (const node of nodes) {
    const info = stats.get(node.id)
    if (!node.external && node.children.length === 0 && info.files === 0) {
      ctx.warnings.push(`Block "${node.id}" matched no files: check its "paths" (folders end with "/", globs use * and **).`)
    }
    if (node.external && node.children.length > 0) ctx.warnings.push(`Block "${node.id}" is "external" but has children; external blocks cannot be opened.`)
    if (node.children.length > 10) ctx.warnings.push(`Block "${node.id}" has ${node.children.length} children; group them into 4–8 parts.`)
    if (CATCH_ALL.test(node.name)) {
      ctx.warnings.push(`Block "${node.id}" ("${node.name}") is a catch-all: give its files real topics, as parts with their own names or inside the parts they belong to.`)
    }
    if (node.children.length === 0 && info.files > 120 && spec.generator === undefined) {
      ctx.warnings.push(`Block "${node.id}" has ${info.files} files and no parts: split it into parts (groups by feature) the reader can open.`)
    } else if (node.children.length === 0 && info.files > 40 && spec.generator === undefined) {
      ctx.notes.push(`Block "${node.id}" has ${info.files} files and no parts; parts would make it easier to read.`)
    }
  }
  // i servizi esterni non si uniscono: il limite vale per i blocchi del progetto
  const inside = roots.filter(id => !byId.get(id).external)
  const outside = roots.length - inside.length
  if (inside.length > 14) ctx.warnings.push(`There are ${inside.length} top-level blocks besides outside services; 5–12 reads better. Merge related ones.`)
  if (outside > 10) ctx.notes.push(`${outside} outside services: keep the ones the reader needs to know.`)
  if (roots.length < 3 && nodes.length > roots.length) ctx.notes.push('Only a few top-level blocks: consider splitting the biggest one.')
  const linked = new Set(edges.flatMap(edge => [...chain(edge.a), ...chain(edge.b)]))
  for (const id of roots) {
    if (!linked.has(id)) ctx.notes.push(`Block "${id}" has no links at all; it will sit apart. Add a link if it relates to another block.`)
  }
  const unnamed = nodes.filter(node => node.auto)
  if (unnamed.length > 0) {
    const message = `${unnamed.length} blocks still have the draft's automatic names (${unnamed.slice(0, 10).map(node => node.id).join(', ')}${unnamed.length > 10 ? ', …' : ''}).`
    if (spec.named === true) ctx.warnings.push(`${message} Give each one a "name" and "summary" in .pharos/names.json.`)
    else ctx.notes.push(`${message} Name them in .pharos/names.json.`)
  }
  for (const node of nodes) {
    if (node.summary === '') ctx.warnings.push(`Block "${node.id}" has no "summary" (one short sentence about what it does).`)
    else if (node.summary.length > 96) ctx.notes.push(`Block "${node.id}": summary is ${node.summary.length} characters; under ~90 fits the card.`)
  }

  // Cosa vedrà la persona aprendo la pagina, con tutti i blocchi chiusi.
  const first = layout.liftEdges(layout.buildModel(data), new Set())

  return {
    ...ctx,
    data,
    stats: {
      blocks: nodes.length,
      top: roots.length,
      links: edges.length,
      fromCode: edges.filter(edge => !edge.declared).length,
      labelled: edges.filter(edge => edge.label !== '').length,
      declared: declared.length,
      ...linkStats,
      addedList: linkStats.addedList,
      shown: first.filter(edge => !edge.minor).length,
      hidden: first.filter(edge => edge.minor).length,
      perTop: roots.filter(id => !byId.get(id).external).map(id => `${byId.get(id).name} ${stats.get(id).files}`),
      assigned: scan.files.length - unassigned.length,
      files: scan.files.length,
    },
  }
}

// ---------------------------------------------------------------- i nomi di Claude sopra la bozza

// La bozza (draft.mjs) dà la struttura; .pharos/names.json dà le parole, per id:
// nomi, frasi, collegamenti con un nome e i file da spostare in un'altra parte.
export function applyNames(spec, names, scan) {
  const out = JSON.parse(JSON.stringify(spec))
  const warnings = []
  if (typeof names !== 'object' || names === null || Array.isArray(names)) return { spec: out, warnings: ['names.json is not an object: ignored.'] }
  out.named = true
  for (const key of ['title', 'summary', 'lang']) if (typeof names[key] === 'string' && names[key].trim() !== '') out[key] = names[key].trim()
  const byId = new Map()
  const visit = list => {
    for (const node of Array.isArray(list) ? list : []) {
      byId.set(node.id, node)
      visit(node.children)
    }
  }
  visit(out.nodes)
  const entries = typeof names.nodes === 'object' && names.nodes !== null ? Object.entries(names.nodes) : []
  for (const [id, entry] of entries) {
    const node = byId.get(id)
    if (node === undefined) {
      warnings.push(`names.json names "${id}", which is not in the map: use the ids the draft printed.`)
      continue
    }
    if (typeof entry === 'string') {
      node.name = entry.trim()
    } else if (typeof entry === 'object' && entry !== null) {
      for (const key of ['name', 'summary', 'about', 'kind']) if (typeof entry[key] === 'string' && entry[key].trim() !== '') node[key] = entry[key].trim()
    }
    delete node.auto
  }
  // i servizi esterni che il codice raggiunge senza una libreria (HTTP, un browser automatico…)
  for (const raw of Array.isArray(names.services) ? names.services : []) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (id === '' || typeof raw.name !== 'string') {
      warnings.push('A service in names.json needs an "id" and a "name".')
      continue
    }
    if (byId.has(id)) {
      warnings.push(`Service "${id}" is already in the map: name it in "nodes" instead.`)
      continue
    }
    const node = { id, name: raw.name.trim(), kind: 'external', summary: typeof raw.summary === 'string' ? raw.summary.trim() : '', packages: Array.isArray(raw.packages) ? raw.packages : [], reach: Array.isArray(raw.reach) ? raw.reach : [] }
    if (typeof raw.about === 'string') node.about = raw.about.trim()
    out.nodes.push(node)
    byId.set(id, node)
  }
  if (Array.isArray(names.links)) out.links = [...(Array.isArray(out.links) ? out.links : []), ...names.links]
  const moves = typeof names.moves === 'object' && names.moves !== null ? Object.entries(names.moves) : []
  const movedAll = []
  for (const [pattern, id] of moves) {
    const target = byId.get(id)
    if (target === undefined || (Array.isArray(target.children) && target.children.length > 0) || target.kind === 'external') {
      warnings.push(`Move "${pattern}" → "${id}" skipped: "${id}" is not a part without parts of its own.`)
      continue
    }
    const test = compilePattern(pattern)
    const hits = scan.files.filter(file => test(file.path) !== undefined).map(file => file.path)
    if (hits.length === 0) {
      warnings.push(`Move "${pattern}" matches no file.`)
      continue
    }
    const moved = new Set(hits)
    for (const node of byId.values()) if (Array.isArray(node.paths)) node.paths = node.paths.filter(raw => !moved.has(raw))
    target.paths = [...(Array.isArray(target.paths) ? target.paths : []), ...hits]
    movedAll.push(...hits)
  }
  // una parte della bozza che gli spostamenti hanno svuotato esce dalla mappa
  if (movedAll.length > 0) {
    const gone = new Set(movedAll)
    const prune = list =>
      list.filter(node => {
        if (Array.isArray(node.children) && node.children.length > 0) {
          node.children = prune(node.children)
          return node.children.length > 0
        }
        if (node.kind === 'external' || !Array.isArray(node.paths) || out.generator === undefined) return true
        const tests = node.paths.map(raw => compilePattern(raw))
        return scan.files.some(file => !gone.has(file.path) && tests.some(test => test(file.path) !== undefined)) || node.paths.some(raw => gone.has(raw))
      })
    out.nodes = prune(out.nodes)
  }

  return { spec: out, warnings }
}

// ---------------------------------------------------------------- la pagina

const read = name => readFileSync(join(ASSETS, name), 'utf8')

export function assemble(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const escape = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

  return read('template.html')
    .replace('__LANG__', () => data.lang)
    .replace('__TITLE__', () => escape(data.title))
    .replace('/*__STYLE__*/', () => read('style.css'))
    .replace('/*__DATA__*/null', () => json)
    .replace('/*__LAYOUT__*/', () => read('layout.js'))
    .replace('/*__APP__*/', () => read('app.js'))
}

function openInBrowser(file) {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]] : ['xdg-open', [file]]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // senza browser da aprire, il percorso del file basta
  }
}

function main() {
  const args = process.argv.slice(2)
  const flag = name => {
    const at = args.indexOf(name)

    return at === -1 ? undefined : args[at + 1]
  }
  const root = resolve(args.find((arg, at) => !arg.startsWith('--') && !['--spec', '--out', '--names'].includes(args[at - 1])) ?? process.cwd())
  if (args.includes('--open')) {
    // riaprire la pagina già fatta, senza rifare niente
    const page = resolve(flag('--out') ?? join(root, '.pharos', 'map.html'))
    if (!existsSync(page)) {
      console.error(`Pharos: no page at ${page} yet. Make the map first.`)
      process.exit(1)
    }
    openInBrowser(page)
    console.log(`Page: ${page}`)

    return
  }
  const specPath = resolve(flag('--spec') ?? join(root, '.pharos', 'map.json'))
  if (!existsSync(specPath)) {
    console.error(`Pharos: no map at ${specPath}. Write it first (see SKILL.md), then run this again.`)
    process.exit(1)
  }
  let spec
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch (error) {
    console.error(`Pharos: ${specPath} is not valid JSON: ${error.message}`)
    process.exit(1)
  }
  const scan = scanProject(root)
  if (scan.files.length === 0) {
    console.error(`Pharos: no source files found in ${root}. Check the folder.`)
    process.exit(1)
  }
  // i nomi scritti da Claude sopra la bozza dell'algoritmo
  const namesPath = resolve(flag('--names') ?? join(dirname(specPath), 'names.json'))
  let early = []
  if (existsSync(namesPath)) {
    try {
      ;({ spec, warnings: early } = applyNames(spec, JSON.parse(readFileSync(namesPath, 'utf8')), scan))
    } catch (error) {
      console.error(`Pharos: ${namesPath} is not valid JSON: ${error.message}`)
      process.exit(1)
    }
  }
  const { data, warnings: late, errors, notes, stats } = buildData(spec, scan)
  const warnings = [...early, ...late]
  if (data === undefined) {
    for (const error of errors) console.error(`ERROR: ${error}`)
    process.exit(1)
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(data, null, 1))

    return
  }

  let out = resolve(flag('--out') ?? join(root, '.pharos', 'map.html'))
  try {
    mkdirSync(dirname(out), { recursive: true })
    if (!flag('--out')) writeFileSync(join(dirname(out), '.gitignore'), '*\n')
    writeFileSync(out, assemble(data))
  } catch {
    out = join(tmpdir(), `pharos-${data.title.replace(/\W+/g, '-')}.html`)
    writeFileSync(out, assemble(data))
  }

  console.log(`Pharos: ${stats.blocks} blocks and parts (${stats.top} blocks at the top), ${stats.links} arrows (${stats.fromCode} from the code), ${stats.assigned}/${stats.files} files placed.`)
  console.log(`Files per top block: ${stats.perTop.join(', ')}.`)
  if (stats.declared > 0) {
    console.log(`Your ${stats.declared} links: ${stats.named} named arrows already in the code, ${stats.added} added arrows the code doesn't show; ${stats.labelled} arrows carry a label.`)
    if (stats.addedList.length > 0) console.log(`Added (not in the code): ${stats.addedList.join(', ')}.`)
  }
  console.log(`With every block closed the page shows ${stats.shown} arrows; ${stats.hidden} more appear when the reader hovers a block.`)
  console.log(`Page: ${out}`)
  for (const warning of warnings) console.log(`WARNING: ${warning}`)
  for (const note of notes) console.log(`note: ${note}`)
  if (warnings.length === 0) console.log('Checks passed: ids, kinds, links, paths, summaries and file coverage.')
  if (!args.includes('--no-open')) openInBrowser(out)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
