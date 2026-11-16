// La pagina di Pharos: disegna i blocchi, i collegamenti, la barra dei dettagli e la ricerca.
;(function () {
  'use strict'

  const D = window.PHAROS
  const L = window.PharosLayout
  const NS = 'http://www.w3.org/2000/svg'
  const systemStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = id => document.getElementById(id)

  const num = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n))
  const esc = text =>
    String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  const lerp = (a, b, t) => a + (b - a) * t
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const f1 = v => v.toFixed(1)

  // ---------------------------------------------------------------- testi
  const TEXT = {
    it: {
      expandAll: 'Apri tutto', collapseAll: 'Chiudi tutto', fit: 'Adatta alla finestra', zoomIn: 'Ingrandisci', zoomOut: 'Riduci',
      file: n => (n === 1 ? '1 file' : `${num(n)} file`),
      lines: n => (n === 1 ? '1 riga' : `${num(n)} righe`),
      parts: n => (n === 1 ? '1 parte' : `${n} parti`),
      used: n => (n === 1 ? '1 file lo usa' : `${n} file lo usano`),
      imports: n => (n === 1 ? '1 import' : `${n} import`),
      uses: 'Usa', usedBy: 'Usato da', parts2: 'Parti', topFiles: 'File più usati', allFiles: n => `File · ${n}`, packages: 'Raggiunto con',
      offers: 'Offre', path: 'Percorso', changed: 'Modificato',
      described: 'Descritto, non verificato nel codice',
      hint: 'Clicca un blocco per aprirlo · passaci sopra per i collegamenti · ⌘K per cercare',
      close: 'Chiudi', details: 'Dettagli', updated: 'Aggiornata',
      search: 'Cerca blocchi, file o funzioni', noResults: 'Nessun risultato', inBlock: 'in', filter: 'Filtra i file',
      ago: d => (d <= 0 ? 'oggi' : d === 1 ? 'ieri' : d < 14 ? `${d} giorni fa` : d < 60 ? `${Math.round(d / 7)} settimane fa` : d < 365 ? `${Math.round(d / 30)} mesi fa` : Math.round(d / 365) === 1 ? 'un anno fa' : `${Math.round(d / 365)} anni fa`),
      activity: (when, n) => `Ultima modifica ${when}${n > 0 ? ` · ${n} ${n === 1 ? 'modifica' : 'modifiche'} in 90 giorni` : ''}`,
      keyUses: 'usa',
      kinds: { interface: 'Interfaccia', api: 'API', logic: 'Logica', data: 'Dati', external: 'Esterno', shared: 'Condiviso', tooling: 'Strumenti', test: 'Test', docs: 'Documenti', other: 'Altro' },
      levels: [['simple', 'Semplice'], ['normal', 'Normale'], ['detail', 'Dettaglio']], level: 'Livello di dettaglio',
      pathHint: 'Maiusc+clic su un altro blocco o file per vedere la strada che li collega',
      settings: 'Impostazioni', appearance: 'Aspetto', themeAuto: 'Automatico', themeLight: 'Chiaro', themeDark: 'Scuro', accent: 'Colore d’evidenza',
      accents: { blue: 'Blu', purple: 'Viola', pink: 'Rosa', orange: 'Arancione', green: 'Verde', graphite: 'Grafite' },
      minimap: 'Minimappa', labels: 'Nomi sulle frecce', motion: 'Animazioni', shortcuts: 'Scorciatoie da tastiera', actual: 'Dimensione reale',
      keys: [['Cerca blocchi, file e funzioni', ['MOD', 'K']], ['Cerca', ['/']], ['Ingrandisci o riduci', ['+', '−']], ['Adatta alla finestra', ['0']], ['Dimensione reale', ['1']], ['Mostra o nascondi la minimappa', ['M']], ['Cambia tema', ['T']], ['Livello: semplice, normale, dettaglio', ['L']], ['Strada tra due blocchi o file', ['Maiusc', 'clic']], ['Chiudi pannelli', ['Esc']], ['Queste scorciatoie', ['?']]],
    },
    en: {
      expandAll: 'Open all', collapseAll: 'Close all', fit: 'Fit to window', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
      file: n => (n === 1 ? '1 file' : `${num(n)} files`),
      lines: n => (n === 1 ? '1 line' : `${num(n)} lines`),
      parts: n => (n === 1 ? '1 part' : `${n} parts`),
      used: n => (n === 1 ? 'used by 1 file' : `used by ${n} files`),
      imports: n => (n === 1 ? '1 import' : `${n} imports`),
      uses: 'Uses', usedBy: 'Used by', parts2: 'Parts', topFiles: 'Most used files', allFiles: n => `Files · ${n}`, packages: 'Reached through',
      offers: 'Offers', path: 'Path', changed: 'Changed',
      described: 'Described, not verified in the code',
      hint: 'Click a block to open it · hover it for its links · ⌘K to search',
      close: 'Close', details: 'Details', updated: 'Updated',
      search: 'Search blocks, files or functions', noResults: 'No results', inBlock: 'in', filter: 'Filter files',
      ago: d => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : d < 365 ? `${Math.round(d / 30)} months ago` : Math.round(d / 365) === 1 ? 'a year ago' : `${Math.round(d / 365)} years ago`),
      activity: (when, n) => `Last change ${when}${n > 0 ? ` · ${n} ${n === 1 ? 'change' : 'changes'} in 90 days` : ''}`,
      keyUses: 'uses',
      kinds: { interface: 'Interface', api: 'API', logic: 'Logic', data: 'Data', external: 'External', shared: 'Shared', tooling: 'Tooling', test: 'Tests', docs: 'Docs', other: 'Other' },
      levels: [['simple', 'Simple'], ['normal', 'Normal'], ['detail', 'Detail']], level: 'Level of detail',
      pathHint: 'Shift-click another block or file to see the way that links them',
      settings: 'Settings', appearance: 'Appearance', themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark', accent: 'Accent colour',
      accents: { blue: 'Blue', purple: 'Purple', pink: 'Pink', orange: 'Orange', green: 'Green', graphite: 'Graphite' },
      minimap: 'Minimap', labels: 'Names on arrows', motion: 'Animations', shortcuts: 'Keyboard shortcuts', actual: 'Actual size',
      keys: [['Search blocks, files and functions', ['MOD', 'K']], ['Search', ['/']], ['Zoom in or out', ['+', '−']], ['Fit to window', ['0']], ['Actual size', ['1']], ['Show or hide the minimap', ['M']], ['Change theme', ['T']], ['Level: simple, normal, detail', ['L']], ['Way between two blocks or files', ['Shift', 'click']], ['Close panels', ['Esc']], ['These shortcuts', ['?']]],
    },
  }
  const T = TEXT[D.lang] || TEXT.en
  const agoOf = seconds => T.ago(Math.floor((Date.now() / 1000 - seconds) / 86400))

  // ---------------------------------------------------------------- stato
  // Una mappa, tre livelli: Semplice (solo i blocchi del prodotto), Normale, Dettaglio (i file dentro le parti).
  const BASE = new Map(D.nodes.map(node => [node.id, node]))
  const baseModel = L.buildModel(D)
  let model = baseModel
  let level = 'normal'
  const nodeOf = id => model.nodes.get(id)
  const isFileId = id => typeof id === 'string' && id.startsWith('f:')
  const FILES = D.files || []
  const importers = FILES.map(() => [])
  FILES.forEach((file, i) => (file.im || []).forEach(j => importers[j] && importers[j].push(i)))

  const topOf = id => {
    let node = BASE.get(id)
    while (node.parent) node = BASE.get(node.parent)

    return node.id
  }
  function modelFor(which) {
    if (which === 'simple') {
      // i blocchi del prodotto e i servizi, chiusi, con le frecce tra loro
      const hide = new Set(['test', 'tooling', 'docs'])
      const roots = D.roots.filter(id => !hide.has(BASE.get(id).kind))
      const keep = new Set(roots)
      const joined = new Map()
      for (const edge of D.edges) {
        const a = topOf(edge.a)
        const b = topOf(edge.b)
        if (a === b || !keep.has(a) || !keep.has(b)) continue
        const key = `${a}>${b}`
        const row = joined.get(key) || { a, b, w: 0, label: '', soft: true, declared: true }
        row.w += edge.w
        if (!edge.soft) row.soft = false
        if (!edge.declared) row.declared = false
        if (edge.label && edge.lf === a && edge.lt === b) Object.assign(row, { label: edge.label, lf: a, lt: b })
        joined.set(key, row)
      }

      return L.buildModel({ roots, nodes: roots.map(id => ({ ...BASE.get(id), children: [] })), edges: [...joined.values()] })
    }
    if (which === 'detail') {
      // ogni parte finale si apre nei suoi file; le frecce vanno da file a file
      const nodes = []
      const fileId = i => `f:${i}`
      for (const node of D.nodes) {
        const isLeaf = node.children.length === 0 && !node.external && (node.own || []).length > 0
        nodes.push(isLeaf ? { ...node, children: node.own.map(fileId) } : node)
        if (!isLeaf) continue
        for (const i of node.own) {
          const file = FILES[i]
          nodes.push({ id: fileId(i), name: baseName(file.p), kind: node.kind, summary: dirName(file.p), about: file.d || '', parent: node.id, children: [], external: false, files: 1, loc: file.loc, own: [i], file: i, usedBy: importers[i].length, last: file.t, recent: file.c })
        }
      }
      const between = new Map(D.edges.map(edge => [`${edge.a}>${edge.b}`, edge]))
      const edges = D.edges.filter(edge => edge.declared || BASE.get(edge.a).external || BASE.get(edge.b).external)
      FILES.forEach((file, i) => {
        for (const j of file.im || []) {
          const to = FILES[j]
          if (to === undefined || j === i) continue
          if (file.n === to.n) {
            edges.push({ a: fileId(i), b: fileId(j), w: 1, label: '', declared: false, soft: false })
            continue
          }
          const owners = between.get(`${file.n}>${to.n}`)
          if (owners === undefined) continue
          edges.push({ a: fileId(i), b: fileId(j), w: 1, label: owners.label, lf: owners.lf, lt: owners.lt, declared: false, soft: owners.soft })
        }
      })

      return L.buildModel({ roots: D.roots, nodes, edges })
    }

    return baseModel
  }
  const expanded = new Set()
  const cards = new Map()
  const cur = new Map()
  const recs = new Map()
  const frameEls = new Map()
  const curF = new Map()
  let boxes = new Map()
  let frames = new Map()
  let routes = new Map()
  let isMoving = false
  let size = { w: 0, h: 0 }
  let edges = []
  let drawn = []
  let view = { x: 0, y: 0, k: 1 }
  let anim = null
  let selected = null
  let hover = null
  let hoverEdge = null
  let lit = new Set()
  let userMoved = false
  let isPanelOn = false

  const stage = $('stage')
  const world = $('world')
  const dotsEl = $('dots')
  const pctEl = $('z-pct')
  const miniEl = $('mini')
  const miniC = $('mini-c')
  const miniV = $('mini-v')
  const prefsEl = $('prefs')
  const prefsBtn = $('b-prefs')
  const sheet = $('sheet')
  const cardsEl = $('cards')
  const framesEl = $('frames')
  const baseG = $('edges-base')
  const edgesBase = $('edges')
  const edgesTop = $('edges-top')
  const chipsEl = $('chips')
  const panel = $('panel')
  const tip = $('tip')
  const hint = $('hint')
  const search = $('q')
  const results = $('results')

  // Le impostazioni valgono per tutte le mappe: tema, colore, minimappa, nomi, animazioni.
  const PREFS = 'pharos:prefs'
  const prefs = { theme: 'auto', accent: 'blue', minimap: true, labels: true, motion: true, level: 'normal' }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) || '{}')
    if (saved && typeof saved === 'object') for (const key of Object.keys(prefs)) if (typeof saved[key] === typeof prefs[key]) prefs[key] = saved[key]
  } catch (error) {
    // senza memoria locale si parte dalle scelte di base
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs))
    } catch (error) {
      // le scelte valgono solo finché la pagina resta aperta
    }
  }

  const STORE = `pharos:${D.title}`
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify([...expanded]))
    } catch (error) {
      // senza memoria locale la mappa funziona lo stesso
    }
  }
  const load = () => {
    try {
      const list = JSON.parse(localStorage.getItem(STORE) || '[]')

      return Array.isArray(list) ? list : []
    } catch (error) {
      return []
    }
  }

  const filesUnder = id => {
    const out = []
    const visit = x => {
      const node = BASE.get(x)
      out.push(...(node.own || []))
      for (const child of node.children) visit(child)
    }
    visit(id)

    return out
  }
  // Un nome che si ripete in più blocchi ("Ordini" nelle pagine, nelle API e nei dati) porta con sé quello del blocco sopra.
  const nameCount = new Map()
  for (const node of D.nodes) nameCount.set(node.name, (nameCount.get(node.name) || 0) + 1)
  const labelOf = id => {
    const node = BASE.get(id) || nodeOf(id)

    return nameCount.get(node.name) > 1 && node.parent ? `${BASE.get(node.parent).name} › ${node.name}` : node.name
  }
  const baseName = path => path.slice(path.lastIndexOf('/') + 1)
  const dirName = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

  // ---------------------------------------------------------------- intestazione
  $('title').textContent = D.title
  const when = D.generated ? new Date(D.generated) : null
  const stamp = when && !Number.isNaN(+when) ? when.toLocaleString(D.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  $('sub').textContent = [D.summary, stamp ? `${T.updated} ${stamp}` : ''].filter(Boolean).join(' · ')
  $('b-open').textContent = T.expandAll
  $('b-close').textContent = T.collapseAll
  for (const [id, label] of [['z-in', T.zoomIn], ['z-out', T.zoomOut], ['z-fit', T.fit]]) {
    $(id).title = label
    $(id).setAttribute('aria-label', label)
  }
  search.placeholder = T.search
  search.setAttribute('aria-label', T.search)
  hint.textContent = T.hint
  const kindsUsed = [...new Set(D.nodes.map(node => node.kind))]
  $('legend').innerHTML =
    kindsUsed.map(kind => `<span class="k-${esc(kind)}"><i></i>${esc(T.kinds[kind] || kind)}</span>`).join('') +
    `<span class="key"><svg viewBox="0 0 30 8"><path d="M1 4h24" class="key-e"/><path d="M23 1.2L28 4l-5 2.8z" class="key-a"/></svg>${esc(T.keyUses)}</span>`

  // ---------------------------------------------------------------- blocchi
  function metaOf(node, withParts) {
    if (node.file !== undefined) return [T.lines(node.loc), node.usedBy > 0 ? T.used(node.usedBy) : ''].filter(Boolean).join(' · ')
    if (node.external) return node.usedBy > 0 ? T.used(node.usedBy) : T.kinds.external
    const bits = [T.file(node.files), T.lines(node.loc)]
    if (withParts !== false && node.children.length > 0) bits.push(T.parts(node.children.length))

    return bits.join(' · ')
  }

  function ensureCard(id) {
    let el = cards.get(id)
    if (el !== undefined) return el
    const node = nodeOf(id)
    const isGroup = node.children.length > 0
    const isFile = node.file !== undefined
    el = document.createElement('div')
    el.className = `card k-${node.kind}${isGroup ? ' group' : ''}${node.parent ? ' part' : ''}${node.external ? ' ext' : ''}${isFile ? ' file' : ''}`
    el.dataset.id = id
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.style.width = `${L.SIZE.cardW}px`
    el.style.height = `${L.SIZE.cardH}px`
    if (isGroup) el.setAttribute('aria-expanded', 'false')
    el.innerHTML =
      `<div class="inner"><div class="head"><span class="ico"><svg class="i"><use href="#i-${esc(node.kind)}"/></svg></span>` +
      `<span class="nm"><span class="name">${esc(node.name)}</span><span class="kd">${esc(T.kinds[node.kind] || node.kind)}</span></span></div>` +
      `<p class="sum">${esc(node.summary)}</p><div class="meta"><span class="txt">${esc(metaOf(node, false))}</span>` +
      (isGroup ? `<span class="more">${esc(isFileId(node.children[0]) ? T.file(node.children.length) : T.parts(node.children.length))}<svg class="i"><use href="#i-chev"/></svg></span>` : '') +
      `</div>` +
      (isGroup ? `<button class="info" type="button" tabindex="-1" aria-label="${esc(T.details)}"><svg class="i"><use href="#i-info"/></svg></button>` : '') +
      `</div>`
    cardsEl.appendChild(el)
    cards.set(id, el)

    return el
  }

  // Le schede hanno tutte la stessa misura: la scala serve solo a farle nascere e sparire.
  function paint(id, v) {
    const el = cards.get(id)
    if (el === undefined) return
    el.style.transform = `translate(${f1(v.x)}px, ${f1(v.y)}px) scale(${(v.w / L.SIZE.cardW).toFixed(4)})`
    el.style.opacity = String(v.a)
  }

  // La sezione di un blocco aperto: il riquadro che tiene insieme la sua scheda e le sue parti.
  function ensureFrame(id) {
    let el = frameEls.get(id)
    if (el !== undefined) return el
    el = document.createElement('div')
    el.className = `frame k-${nodeOf(id).kind} d${Math.min(3, model.chain.get(id).length)}`
    framesEl.appendChild(el)
    frameEls.set(id, el)

    return el
  }

  function paintFrame(id, v) {
    const el = frameEls.get(id)
    if (el === undefined) return
    el.style.transform = `translate(${f1(v.x)}px, ${f1(v.y)}px)`
    el.style.width = `${f1(v.w)}px`
    el.style.height = `${f1(v.h)}px`
    el.style.setProperty('--a', v.a.toFixed(3))
  }

  const mix = (from, to, e) => ({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), w: lerp(from.w, to.w, e), h: lerp(from.h, to.h, e), a: lerp(from.a, to.a, e), gone: to.gone })
  const shrunk = (box, at) => {
    const w = L.SIZE.cardW * 0.3
    const h = L.SIZE.cardH * 0.3
    const c = at || box

    return { x: c.x + c.w / 2 - w / 2, y: c.y + c.h / 2 - h / 2, w, h, a: 0 }
  }

  // ---------------------------------------------------------------- vista
  let dotStep = 0
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
    let step = 24 * view.k
    while (step < 14) step *= 2
    while (step > 96) step /= 2
    // lo sfondo cambia misura solo con lo zoom; spostarlo è solo una traslazione del suo livello
    if (Math.abs(step - dotStep) > 0.01) {
      dotStep = step
      dotsEl.style.setProperty('--dots', `${step}px`)
    }
    const ox = ((view.x % step) + step) % step
    const oy = ((view.y % step) + step) % step
    dotsEl.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`
    const pct = `${Math.round(view.k * 100)}%`
    if (pctEl.textContent !== pct) pctEl.textContent = pct
    miniView()
  }

  // Durante un gesto la mappa resta un livello solo; le frecce si ridisegnano quando ci si ferma.
  let settleTimer = 0
  let edgesStale = false
  function interacting(staleEdges) {
    if (staleEdges) edgesStale = true
    world.classList.add('live')
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      world.classList.remove('live')
      if (edgesStale) {
        edgesStale = false
        drawEdges()
      }
    }, 160)
  }

  function safeRect() {
    const panelW = isPanelOn && window.innerWidth > 640 ? 412 : 0

    return { x: 28, y: 56 + 24, w: Math.max(200, window.innerWidth - 56 - panelW), h: Math.max(160, window.innerHeight - 56 - 24 - 76) }
  }

  const centerOn = (box, k, r) => ({ k, x: r.x + r.w / 2 - (box.x + box.w / 2) * k, y: r.y + r.h / 2 - (box.y + box.h / 2) * k })

  function fitView(w, h) {
    const r = safeRect()
    const k = clamp(Math.min(r.w / Math.max(1, w), r.h / Math.max(1, h)), 0.06, 1.1)

    return centerOn({ x: 0, y: 0, w, h }, k, r)
  }

  function ensureVisible(v, box) {
    const r = safeRect()
    if (box.w * v.k > r.w || box.h * v.k > r.h) return centerOn(box, Math.max(0.06, Math.min(v.k, r.w / box.w, r.h / box.h)), r)
    let { x, y } = v
    const left = x + box.x * v.k
    const top = y + box.y * v.k
    const right = left + box.w * v.k
    const bottom = top + box.h * v.k
    if (left < r.x) x += r.x - left
    else if (right > r.x + r.w) x -= right - (r.x + r.w)
    if (top < r.y) y += r.y - top
    else if (bottom > r.y + r.h) y -= bottom - (r.y + r.h)

    return { k: v.k, x, y }
  }

  // Il riquadro di un blocco con le sue parti aperte: la sua sezione, o la sola scheda.
  const groupBox = id => frames.get(id) || boxes.get(id)

  // ---------------------------------------------------------------- collegamenti
  const toward = (from, to, dist) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1

    return { x: from.x + ((to.x - from.x) * dist) / len, y: from.y + ((to.y - from.y) * dist) / len }
  }

  // Una spezzata ad angoli retti con gli spigoli arrotondati.
  function roundPath(pts, radius) {
    let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`
    for (let i = 1; i + 1 < pts.length; i += 1) {
      const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]]
      const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2)
      const a = toward(c, p, r)
      const b = toward(c, n, r)
      d += `L${f1(a.x)} ${f1(a.y)}Q${f1(c.x)} ${f1(c.y)} ${f1(b.x)} ${f1(b.y)}`
    }
    const last = pts[pts.length - 1]

    return `${d}L${f1(last.x)} ${f1(last.y)}`
  }

  // Una freccia con la sua corsia: la strada viene dal layout, la punta va verso b.
  function routedGeometry(edge, r) {
    const isDown = edge.a === r.top
    const atEnd = isDown || edge.bidir
    const atStart = !isDown || edge.bidir
    const pts = r.points.map(p => ({ ...p }))
    if (atEnd) pts[pts.length - 1].y -= 2.5
    if (atStart) pts[0].y += 2.5

    return { d: roundPath(pts, 14), pts, atStart, atEnd }
  }

  const overlapArea = (p, q) => Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y))

  // Il punto dove l'etichetta non copre schede né altre etichette, il più vicino a metà strada.
  function labelSpot(pts, label, solid, taken) {
    const halfW = Math.min(96, 13 + label.length * 3.3)
    const halfH = 11
    const parts = []
    let total = 0
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
      parts.push({ a: pts[i], b: pts[i + 1], len, at: total })
      total += len
    }
    const tries = []
    for (const part of parts) {
      const isFlat = Math.abs(part.a.y - part.b.y) < 0.5
      if (part.len < (isFlat ? halfW * 2 + 10 : halfH * 2 + 14)) continue
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const p = { x: lerp(part.a.x, part.b.x, t), y: lerp(part.a.y, part.b.y, t) }
        tries.push({ p, order: Math.abs(part.at + part.len * t - total / 2) / Math.max(1, total) + (isFlat ? 0 : 0.05) })
      }
    }
    if (tries.length === 0) tries.push({ p: { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 }, order: 0 })
    tries.sort((p, q) => p.order - q.order)
    let best = tries[0].p
    let least = Infinity
    for (const { p } of tries) {
      const box = { x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 }
      let covered = 0
      for (const one of solid) covered += overlapArea(box, one)
      for (const one of taken) covered += overlapArea(box, one) * 3
      if (covered < least) {
        least = covered
        best = p
      }
      if (covered === 0) break
    }
    taken.push({ x: best.x - halfW, y: best.y - halfH, w: halfW * 2, h: halfH * 2 })

    return best
  }

  // Scrive un attributo o uno stile solo se è cambiato: riscriverlo uguale costa un ridisegno.
  function put(rec, key, write, value) {
    if (rec.last[key] === value) return
    rec.last[key] = value
    write(value)
  }

  function makeRec() {
    const base = document.createElementNS(NS, 'path')
    const hit = document.createElementNS(NS, 'path')
    hit.setAttribute('class', 'hit')
    baseG.appendChild(base)
    baseG.appendChild(hit)
    const chip = document.createElement('div')
    chip.className = 'chip'
    chipsEl.appendChild(chip)

    return { base, hit, hi: null, chip, last: {} }
  }

  function dropRec(id) {
    const rec = recs.get(id)
    if (rec === undefined) return
    rec.base.remove()
    rec.hit.remove()
    rec.chip.remove()
    if (rec.hi) rec.hi.remove()
    recs.delete(id)
  }

  const setMarkers = (path, geo, marker) => {
    if (geo.atEnd) path.setAttribute('marker-end', `url(#${marker})`)
    else path.removeAttribute('marker-end')
    if (geo.atStart) path.setAttribute('marker-start', `url(#${marker})`)
    else path.removeAttribute('marker-start')
  }

  function drawEdges() {
    if (isMoving) return
    const solid = []
    for (const v of cur.values()) if (v.a > 0.3) solid.push(v)
    const taken = []
    const isFocused = edgesBase.classList.contains('focus')
    const named = edges.filter(edge => !edge.minor && edge.named).length
    const live = new Set()
    const list = drawn.slice().sort((p, q) => Number(q.named) - Number(p.named) || q.w - p.w)
    for (const edge of list) {
      if (!cur.has(edge.a) || !cur.has(edge.b)) continue
      const isLit = lit.has(edge.id)
      const r = routes.get(edge.id)
      // le frecce senza corsia non si disegnano: passandoci sopra si accendono i blocchi che collegano
      if (r === undefined) continue
      live.add(edge.id)
      let rec = recs.get(edge.id)
      if (rec === undefined) {
        rec = makeRec()
        recs.set(edge.id, rec)
      }
      put(rec, 'id', value => (rec.hit.dataset.edge = value), edge.id)
      const geo = routedGeometry(edge, r)
      put(rec, 'd', () => {
        rec.base.setAttribute('d', geo.d)
        rec.hit.setAttribute('d', geo.d)
        setMarkers(rec.base, geo, 'ar')
      }, `${geo.d}|${geo.atStart}|${geo.atEnd}`)
      put(rec, 'cls', value => rec.base.setAttribute('class', value), `e${edge.soft ? ' soft' : ''}${isLit ? ' lit' : ''}`)
      put(rec, 'sw', value => (rec.base.style.strokeWidth = value), Math.max(1.35 + Math.min(0.9, Math.log10(edge.w + 1) * 0.5), 1.1 / view.k).toFixed(2))
      put(rec, 'o', value => rec.base.style.setProperty('--o', value), String(edge.soft ? 0.6 : 0.62 + Math.min(0.3, Math.log10(edge.w + 1) * 0.14)))
      put(rec, 'hw', value => (rec.hit.style.strokeWidth = value), Math.max(12, 14 / view.k).toFixed(1))

      if (isLit) {
        if (rec.hi === null) {
          rec.hi = document.createElementNS(NS, 'path')
          edgesTop.appendChild(rec.hi)
        }
        rec.hi.setAttribute('class', 'hi')
        rec.hi.setAttribute('d', geo.d)
        setMarkers(rec.hi, geo, 'ar-hi')
        rec.hi.style.strokeWidth = String(Math.max(2.2, 2 / view.k))
      } else if (rec.hi !== null) {
        rec.hi.remove()
        rec.hi = null
      }

      put(rec, 'label', value => (rec.chip.textContent = value), edge.label || '')
      const isOn = Boolean(edge.label) && (isLit || (prefs.labels && !isFocused && edge.named && !edge.minor && named <= 30))
      rec.chip.classList.toggle('on', isOn)
      rec.chip.classList.toggle('hot', isLit)
      if (isOn) {
        const at = labelSpot(geo.pts, edge.label, solid, taken)
        put(rec, 'at', value => (rec.chip.style.transform = value), `translate(${f1(at.x)}px, ${f1(at.y)}px) translate(-50%, -50%)`)
      }
    }
    for (const id of [...recs.keys()]) if (!live.has(id)) dropRec(id)
  }

  // ---------------------------------------------------------------- evidenza
  const touches = (edge, id) => edge.a === id || edge.b === id || L.isAncestor(model, id, edge.a) || L.isAncestor(model, id, edge.b)

  function withAncestors(set, id) {
    for (const one of model.chain.get(id)) set.add(one)
  }

  function setFocus() {
    lit = new Set()
    let keep = null
    const related = new Set()
    const hovered = hoverEdge !== null ? drawn.find(edge => edge.id === hoverEdge) : undefined
    if (path !== null && hover === null && hovered === undefined) {
      keep = new Set()
      for (const id of path.edges) lit.add(id)
      for (const id of path.nodes) {
        withAncestors(keep, id)
        related.add(id)
      }
    } else if (hovered !== undefined) {
      lit.add(hovered.id)
      keep = new Set()
      withAncestors(keep, hovered.a)
      withAncestors(keep, hovered.b)
    } else {
      const subject = hover !== null ? hover : selected
      if (subject !== null && model.nodes.has(subject)) {
        const id = L.repOf(model, subject, expanded)
        keep = new Set()
        withAncestors(keep, id)
        for (const visible of L.visibleIds(model, expanded)) if (L.isAncestor(model, id, visible)) keep.add(visible)
        for (const edge of drawn) {
          if (!touches(edge, id)) continue
          lit.add(edge.id)
          withAncestors(keep, edge.a)
          withAncestors(keep, edge.b)
          for (const end of [edge.a, edge.b]) if (end !== id && !L.isAncestor(model, id, end)) related.add(end)
        }
      }
    }
    edgesBase.classList.toggle('focus', keep !== null)
    for (const [id, el] of cards) {
      el.classList.toggle('dim', keep !== null && !keep.has(id))
      el.classList.toggle('rel', related.has(id))
      el.classList.toggle('sel', id === selected)
    }
    for (const [id, el] of frameEls) el.classList.toggle('dim', keep !== null && !keep.has(id))
    drawEdges()
  }

  // ---------------------------------------------------------------- animazione
  // Mentre i blocchi si spostano le frecce spariscono; ricompaiono sulla strada nuova.
  function finishAnim() {
    if (anim === null) return
    const done = anim
    anim = null
    for (const [id, to] of done.to) {
      if (to.gone) {
        cur.delete(id)
        const el = cards.get(id)
        if (el !== undefined) el.remove()
        cards.delete(id)
      } else {
        cur.set(id, { ...to })
        paint(id, to)
      }
    }
    for (const [id, to] of done.fTo) {
      if (to.gone) {
        curF.delete(id)
        const el = frameEls.get(id)
        if (el !== undefined) el.remove()
        frameEls.delete(id)
      } else {
        curF.set(id, { ...to })
        paintFrame(id, to)
      }
    }
    view = { ...done.v1 }
    drawMini()
    applyView()
    if (isMoving) {
      isMoving = false
      world.classList.remove('moving')
    }
    drawEdges()
  }

  function tick(now) {
    if (anim === null) return
    const t = anim.dur === 0 ? 1 : clamp((now - anim.t0) / anim.dur, 0, 1)
    const e = 1 - Math.pow(1 - t, 3)
    for (const [id, to] of anim.to) {
      const v = mix(anim.from.get(id), to, e)
      cur.set(id, v)
      paint(id, v)
    }
    for (const [id, to] of anim.fTo) {
      const v = mix(anim.fFrom.get(id), to, e)
      curF.set(id, v)
      paintFrame(id, v)
    }
    view = { x: lerp(anim.v0.x, anim.v1.x, e), y: lerp(anim.v0.y, anim.v1.y, e), k: lerp(anim.v0.k, anim.v1.k, e) }
    drawMini()
    applyView()
    if (t < 1) requestAnimationFrame(tick)
    else finishAnim()
  }

  function startAnim(from, to, fFrom, fTo, v1, dur) {
    finishAnim()
    const mine = { from, to, fFrom, fTo, v0: { ...view }, v1, t0: performance.now(), dur: systemStill || !prefs.motion ? 0 : dur }
    anim = mine
    if (to.size > 0 || fTo.size > 0) {
      isMoving = true
      world.classList.add('moving')
    }
    requestAnimationFrame(tick)
    // In una scheda nascosta i frame non arrivano: a fine tempo si salta allo stato finale.
    window.setTimeout(() => {
      if (anim === mine) finishAnim()
    }, mine.dur + 200)
  }

  function goView(v1, dur) {
    if (Math.abs(v1.x - view.x) < 0.5 && Math.abs(v1.y - view.y) < 0.5 && Math.abs(v1.k - view.k) < 0.001) return
    startAnim(new Map(), new Map(), new Map(), new Map(), v1, dur || 380)
  }

  // ---------------------------------------------------------------- il layout
  // opts: initial | fit | center: id | keep: { id, sx, sy }
  function relayout(opts) {
    const o = opts || {}
    finishAnim()
    edges = L.liftEdges(model, expanded)
    drawn = edges
    const res = L.layout(model, expanded, edges)
    boxes = res.boxes
    frames = res.frames
    routes = res.routes
    size = { w: res.width, h: res.height }
    // con tante schede le sfumature al passaggio diventano istantanee: ogni fotogramma ridipingerebbe tutto
    stage.classList.toggle('many', boxes.size > 48)

    const from = new Map()
    const to = new Map()
    for (const [id, box] of boxes) {
      const el = ensureCard(id)
      to.set(id, { x: box.x, y: box.y, w: box.w, h: box.h, a: 1 })
      const old = cur.get(id)
      if (old !== undefined) {
        from.set(id, { ...old })
      } else {
        const parent = nodeOf(id).parent
        const at = parent ? cur.get(parent) : undefined
        from.set(id, at !== undefined ? shrunk(box, at) : { x: box.x, y: box.y + 18, w: box.w, h: box.h, a: 0 })
      }
      el.classList.toggle('open', box.isOpen)
      el.classList.remove('leaving')
      if (nodeOf(id).children.length > 0) el.setAttribute('aria-expanded', box.isOpen ? 'true' : 'false')
    }
    const nearest = id => {
      let up = id
      while (up && !boxes.has(up)) up = nodeOf(up).parent

      return up ? boxes.get(up) : undefined
    }
    for (const [id, v] of cur) {
      if (boxes.has(id)) continue
      const at = nearest(nodeOf(id).parent)
      from.set(id, { ...v })
      to.set(id, { ...(at ? shrunk(v, at) : { ...v, a: 0 }), gone: true })
      const el = cards.get(id)
      if (el !== undefined) el.classList.add('leaving')
    }

    // le sezioni nascono dalla scheda del loro blocco e ci tornano quando si chiudono
    const fFrom = new Map()
    const fTo = new Map()
    for (const [id, frame] of frames) {
      ensureFrame(id)
      fTo.set(id, { ...frame, a: 1 })
      const old = curF.get(id)
      const at = cur.get(id) || from.get(id)
      fFrom.set(id, old !== undefined ? { ...old } : at !== undefined ? { x: at.x, y: at.y, w: at.w, h: at.h, a: 0 } : { ...frame, a: 0 })
    }
    for (const [id, v] of curF) {
      if (frames.has(id)) continue
      const at = nearest(id)
      fFrom.set(id, { ...v })
      fTo.set(id, { ...(at ? { x: at.x, y: at.y, w: at.w, h: at.h } : v), a: 0, gone: true })
    }

    let v1 = { ...view }
    if (o.initial || o.fit) v1 = fitView(size.w, size.h)
    else if (o.center !== undefined) v1 = centerOn(boxes.get(L.repOf(model, o.center, expanded)), clamp(view.k, 0.55, 1), safeRect())
    else if (o.keep !== undefined && boxes.has(o.keep.id)) {
      // se tutta la mappa ci sta a una misura leggibile si mostra intera; altrimenti
      // il blocco toccato resta dov'era e si porta in vista con la sua sezione
      const whole = fitView(size.w, size.h)
      if (!userMoved && whole.k >= 0.5) {
        v1 = whole
      } else {
        const at = boxes.get(o.keep.id)
        v1 = ensureVisible({ k: view.k, x: o.keep.sx - at.x * view.k, y: o.keep.sy - at.y * view.k }, groupBox(o.keep.id))
      }
    }
    if (o.initial) {
      view = { ...v1 }
      applyView()
    }
    startAnim(from, to, fFrom, fTo, v1, o.initial ? 700 : 560)
    setFocus()
  }

  function toggle(id, want) {
    const node = nodeOf(id)
    if (node.children.length === 0) return
    const was = expanded.has(id)
    const next = want === undefined ? !was : want
    if (next === was) return
    const at = boxes.get(id)
    const keep = at !== undefined ? { id, sx: view.x + at.x * view.k, sy: view.y + at.y * view.k } : undefined
    if (next) expanded.add(id)
    else for (const one of [...expanded]) if (one === id || L.isAncestor(model, id, one)) expanded.delete(one)
    save()
    relayout({ keep })
  }

  function setAll(isOpen) {
    expanded.clear()
    // anche in Dettaglio "Apri tutto" si ferma alle parti: tutti i file insieme sarebbero troppi
    if (isOpen) for (const node of model.nodes.values()) if (node.children.length > 0 && !isFileId(node.children[0])) expanded.add(node.id)
    save()
    userMoved = false
    relayout({ fit: true })
  }

  // ---------------------------------------------------------------- pannello dei dettagli
  function relations(id) {
    const inside = x => x === id || L.isAncestor(baseModel, id, x)
    const out = new Map()
    const inn = new Map()
    for (const edge of baseModel.edges) {
      const aIn = inside(edge.a)
      const bIn = inside(edge.b)
      if (aIn === bIn) continue
      const group = L.commonParent(baseModel, id, aIn ? edge.b : edge.a).second
      if (!group) continue
      const map = aIn ? out : inn
      let row = map.get(group)
      if (row === undefined) {
        row = { id: group, w: 0, labels: new Map(), declared: true }
        map.set(group, row)
      }
      row.w += edge.w
      if (!edge.declared) row.declared = false
      if (edge.label) row.labels.set(edge.label, (row.labels.get(edge.label) || 0) + edge.w)
    }
    const finish = map =>
      [...map.values()]
        .map(row => {
          let label
          let best = -1
          for (const [text, w] of row.labels) {
            if (w > best) {
              label = text
              best = w
            }
          }

          return { ...row, label }
        })
        .sort((a, b) => b.w - a.w)

    return { out: finish(out), inn: finish(inn) }
  }

  const nodeRow = (target, text) =>
    `<li tabindex="0" role="button" data-go="${esc(target)}" class="k-${esc(nodeOf(target).kind)}"><span class="dot"></span>` +
    `<span class="rn">${esc(labelOf(target))}</span><span class="rl">${esc(text)}</span><svg class="i go"><use href="#i-chev"/></svg></li>`

  function fileRow(i) {
    const file = FILES[i]
    const dir = dirName(file.p)
    const offers = file.ex || []

    return (
      `<li class="f" data-file="${i}" tabindex="0">` +
      `<div class="fr"><span class="fn">${esc(baseName(file.p))}</span><span class="fm">${esc(T.lines(file.loc))}${file.by > 0 ? ` · ← ${file.by}` : ''}</span></div>` +
      (dir ? `<div class="fd">${esc(dir)}</div>` : '') +
      (file.d ? `<div class="fa">${esc(file.d)}</div>` : '') +
      (offers.length > 0
        ? `<div class="fx">${offers.slice(0, 4).map(name => `<code>${esc(name)}</code>`).join('')}${offers.length > 4 ? `<span>+${offers.length - 4}</span>` : ''}</div>`
        : '') +
      `<div class="fmore"></div></li>`
    )
  }

  // Il dettaglio di un file: cosa offre, con quali blocchi parla, quando è cambiato.
  function fileDetails(i) {
    const file = FILES[i]
    const tally = list => {
      const counts = new Map()
      for (const j of list) {
        const owner = FILES[j] && FILES[j].n
        if (owner === undefined || owner === file.n) continue
        counts.set(owner, (counts.get(owner) || 0) + 1)
      }

      return [...counts].sort((a, b) => b[1] - a[1])
    }
    const tags = rows =>
      rows
        .map(([id, n]) => `<button type="button" class="tag k-${esc(nodeOf(id).kind)}" data-go="${esc(id)}"><i></i>${esc(labelOf(id))}<b>${n}</b></button>`)
        .join('')
    const uses = tally(file.im || [])
    const usedBy = tally(importers[i])
    const line = (label, body) => (body ? `<div class="fl"><span>${esc(label)}</span><div>${body}</div></div>` : '')

    return (
      line(T.offers, (file.ex || []).length > 4 ? file.ex.map(name => `<code>${esc(name)}</code>`).join('') : '') +
      line(T.uses, [tags(uses), (file.pk || []).map(name => `<code class="pkg">${esc(name)}</code>`).join('')].join('')) +
      line(T.usedBy, tags(usedBy)) +
      line(T.changed, file.t ? esc(T.activity(agoOf(file.t), file.c || 0).replace(/^[^ ]+ [^ ]+ /, '')) : '') +
      line(T.path, `<code class="path">${esc(file.p)}</code>`)
    )
  }

  function renderPanel(id) {
    const node = BASE.get(id)
    const rel = relations(id)
    const relRow = r => nodeRow(r.id, [r.label, r.declared ? '' : T.imports(r.w)].filter(Boolean).join(' · '))
    const section = (title, body) => (body ? `<h3>${esc(title)}</h3>${body}` : '')
    const list = filesUnder(id).sort((a, b) => FILES[b].by - FILES[a].by || FILES[b].loc - FILES[a].loc || (FILES[a].p < FILES[b].p ? -1 : 1))
    const isLeaf = node.children.length === 0
    const shown = isLeaf ? list : list.slice(0, 8)
    const filesHtml =
      shown.length > 0
        ? (isLeaf && list.length > 8 ? `<input class="filter" type="search" placeholder="${esc(T.filter)}" aria-label="${esc(T.filter)}">` : '') +
          `<ul class="files">${shown.map(fileRow).join('')}</ul>`
        : ''

    panel.className = `panel on k-${node.kind}`
    panel.innerHTML =
      `<div class="p-head"><span class="ico"><svg class="i"><use href="#i-${esc(node.kind)}"/></svg></span>` +
      `<div class="p-title"><h2>${esc(node.name)}</h2><p>${esc(T.kinds[node.kind] || node.kind)} · ${esc(metaOf(node))}</p></div>` +
      `<button class="x" type="button" aria-label="${esc(T.close)}"><svg class="i"><use href="#i-x"/></svg></button></div>` +
      `<p class="p-sum">${esc(node.about || node.summary)}</p>` +
      (node.last ? `<p class="p-act">${esc(T.activity(agoOf(node.last), node.recent || 0))}</p>` : '') +
      section(T.uses, rel.out.length ? `<ul class="rel">${rel.out.map(relRow).join('')}</ul>` : '') +
      section(T.usedBy, rel.inn.length ? `<ul class="rel">${rel.inn.map(relRow).join('')}</ul>` : '') +
      section(T.parts2, node.children.length ? `<ul class="rel">${node.children.map(child => nodeRow(child, metaOf(BASE.get(child)))).join('')}</ul>` : '') +
      section(isLeaf ? T.allFiles(list.length) : T.topFiles, filesHtml) +
      section(T.packages, node.packages && node.packages.length ? `<div class="pk">${node.packages.map(name => `<span>${esc(name)}</span>`).join('')}</div>` : '') +
      `<p class="p-hint">${esc(T.pathHint)}</p>`
  }

  function toggleFile(row, isOpen) {
    const more = row.querySelector('.fmore')
    const open = isOpen === undefined ? !row.classList.contains('open') : isOpen
    if (open && more.innerHTML === '') more.innerHTML = fileDetails(Number(row.dataset.file))
    row.classList.toggle('open', open)
  }

  function openPanel(id, keepView) {
    selected = id
    isPanelOn = true
    renderPanel(id)
    panel.scrollTop = 0
    setFocus()
    if (!keepView) {
      const at = boxes.get(L.repOf(model, id, expanded))
      if (at !== undefined) goView(ensureVisible({ ...view }, at), 360)
    }
  }

  function closePanel() {
    path = null
    if (selected === null) return
    selected = null
    isPanelOn = false
    panel.classList.remove('on')
    setFocus()
  }

  // Apre i blocchi che contengono quello scelto e ci va.
  function goTo(id) {
    // un blocco che a questo livello non c'è: si torna al livello normale
    if (!model.nodes.has(id)) setLevel('normal')
    let isChanged = false
    for (const up of model.chain.get(id).slice(1)) {
      if (!expanded.has(up)) {
        expanded.add(up)
        isChanged = true
      }
    }
    if (isChanged) save()
    selected = id
    isPanelOn = true
    relayout({ center: id })
    if (isFileId(id)) {
      openFile(nodeOf(id).file, id)

      return
    }
    renderPanel(id)
    panel.scrollTop = 0
  }

  // Un file in Dettaglio: il pannello della sua parte, con il file aperto
  function openFile(i, id) {
    openPanel(FILES[i].n, true)
    selected = id
    setFocus()
    const row = panel.querySelector(`.f[data-file="${i}"]`)
    if (row === null) return
    toggleFile(row, true)
    row.scrollIntoView({ block: 'center' })
  }

  // La strada più corta tra due schede, sulle frecce che si vedono
  let path = null
  function showPath(from, to) {
    const near = new Map()
    for (const edge of edges) {
      if (!cur.has(edge.a) || !cur.has(edge.b)) continue
      for (const [x, y] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        if (!near.has(x)) near.set(x, [])
        near.get(x).push({ to: y, edge })
      }
    }
    const back = new Map([[from, null]])
    const queue = [from]
    while (queue.length > 0 && !back.has(to)) {
      const x = queue.shift()
      for (const step of near.get(x) || []) {
        if (back.has(step.to)) continue
        back.set(step.to, { from: x, edge: step.edge })
        queue.push(step.to)
      }
    }
    if (!back.has(to)) {
      path = { nodes: new Set([from, to]), edges: new Set() }
    } else {
      path = { nodes: new Set([to]), edges: new Set() }
      for (let x = to; back.get(x) !== null; x = back.get(x).from) {
        path.edges.add(back.get(x).edge.id)
        path.nodes.add(back.get(x).from)
      }
    }
    setFocus()
  }

  function goToFile(i) {
    // in Dettaglio si va alla scheda del file
    if (level === 'detail' && model.nodes.has(`f:${i}`)) {
      goTo(`f:${i}`)

      return
    }
    goTo(FILES[i].n)
    const row = panel.querySelector(`.f[data-file="${i}"]`)
    if (row === null) return
    toggleFile(row, true)
    row.classList.add('flash')
    window.setTimeout(() => row.classList.remove('flash'), 1600)
    row.scrollIntoView({ block: 'center' })
  }

  function cardClick(id, isPath) {
    // Maiusc+clic: la strada dal blocco scelto prima a questo
    if (isPath && selected !== null && selected !== id && cur.has(selected)) {
      showPath(selected, id)

      return
    }
    path = null
    const node = nodeOf(id)
    if (node.file !== undefined) {
      openFile(node.file, id)

      return
    }
    if (node.children.length === 0) {
      openPanel(id)

      return
    }
    toggle(id)
    if (isPanelOn) openPanel(id, true)
  }

  // ---------------------------------------------------------------- ricerca
  const entries = [
    ...D.nodes.map(node => ({ type: 'node', id: node.id, name: node.name.toLowerCase(), hay: `${node.name} ${node.summary} ${node.about || ''}`.toLowerCase() })),
    ...FILES.map((file, i) => ({ type: 'file', id: i, name: baseName(file.p).toLowerCase(), path: file.p.toLowerCase(), ex: (file.ex || []).map(name => name.toLowerCase()) })),
  ]
  let found = []
  let active = 0

  function runSearch(query) {
    const q = query.trim().toLowerCase()
    if (q === '') {
      results.classList.remove('on')
      found = []

      return
    }
    const scored = []
    for (const entry of entries) {
      let score = 0
      let why = ''
      if (entry.type === 'node') {
        if (entry.name.startsWith(q)) score = 5
        else if (entry.name.includes(q)) score = 4
        else if (entry.hay.includes(q)) score = 1.5
      } else {
        const exact = entry.ex.find(name => name === q)
        const part = exact || entry.ex.find(name => name.includes(q))
        if (entry.name.startsWith(q)) score = 3.6
        else if (exact !== undefined) score = 3.4
        else if (entry.name.includes(q)) score = 3
        else if (part !== undefined) score = 2.4
        else if (entry.path.includes(q)) score = 1
        if (part !== undefined && !entry.name.includes(q)) why = FILES[entry.id].ex.find(name => name.toLowerCase() === part)
      }
      if (score > 0) scored.push({ entry, score, why })
    }
    scored.sort((a, b) => b.score - a.score || (a.entry.type === 'file' ? FILES[b.entry.id].by - FILES[a.entry.id].by : 0))
    found = [...scored.filter(one => one.entry.type === 'node').slice(0, 5), ...scored.filter(one => one.entry.type === 'file').slice(0, 8)]
    active = 0
    results.innerHTML =
      found.length === 0
        ? `<div class="none">${esc(T.noResults)}</div>`
        : found
            .map((one, k) => {
              if (one.entry.type === 'node') {
                const node = nodeOf(one.entry.id)
                const parent = node.parent ? nodeOf(node.parent).name : ''

                return (
                  `<button type="button" class="res k-${esc(node.kind)}${k === active ? ' on' : ''}" data-k="${k}"><span class="ico"><svg class="i"><use href="#i-${esc(node.kind)}"/></svg></span>` +
                  `<span class="rt"><b>${esc(node.name)}</b><small>${esc(parent ? `${T.inBlock} ${parent}` : node.summary)}</small></span></button>`
                )
              }
              const file = FILES[one.entry.id]
              const owner = nodeOf(file.n)

              return (
                `<button type="button" class="res file k-${esc(owner.kind)}${k === active ? ' on' : ''}" data-k="${k}"><span class="dot"></span>` +
                `<span class="rt"><b>${esc(baseName(file.p))}</b><small>${esc(one.why ? `${T.offers} ${one.why} · ` : '')}${esc(labelOf(file.n))} · ${esc(dirName(file.p))}</small></span></button>`
              )
            })
            .join('')
    results.classList.add('on')
  }

  function choose(k) {
    const one = found[k]
    if (one === undefined) return
    results.classList.remove('on')
    search.blur()
    if (one.entry.type === 'node') goTo(one.entry.id)
    else goToFile(one.entry.id)
  }

  search.addEventListener('input', () => runSearch(search.value))
  search.addEventListener('focus', () => {
    if (search.value) runSearch(search.value)
  })
  search.addEventListener('blur', () => window.setTimeout(() => results.classList.remove('on'), 150))
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (found.length === 0) return
      active = (active + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length
      for (const el of results.querySelectorAll('.res')) el.classList.toggle('on', Number(el.dataset.k) === active)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      search.value = ''
      results.classList.remove('on')
      search.blur()
    }
  })
  results.addEventListener('mousedown', event => {
    const el = event.target.closest('.res')
    if (el === null) return
    event.preventDefault()
    choose(Number(el.dataset.k))
  })

  // ---------------------------------------------------------------- suggerimento e tooltip
  let isHinted = false
  function dismissHint() {
    if (isHinted) return
    isHinted = true
    hint.classList.add('gone')
  }

  function showTip(event) {
    const edge = drawn.find(one => one.id === hoverEdge)
    if (edge === undefined) return
    tip.innerHTML =
      `<b>${esc(labelOf(edge.a))}</b> ${edge.bidir ? '↔' : '→'} <b>${esc(labelOf(edge.b))}</b>` +
      (edge.label ? ` · ${esc(edge.label)}` : '') +
      `<br>${esc(edge.declared ? T.described : T.imports(edge.w))}`
    tip.classList.add('on')
    moveTip(event)
  }
  function moveTip(event) {
    const width = tip.offsetWidth
    tip.style.left = `${Math.min(window.innerWidth - width - 10, event.clientX + 14)}px`
    tip.style.top = `${event.clientY + 16}px`
  }
  const hideTip = () => tip.classList.remove('on')

  // ---------------------------------------------------------------- eventi
  const pointers = new Map()
  let drag = null
  let pinch = null

  function zoomAt(cx, cy, factor) {
    const k = clamp(view.k * factor, 0.08, 2.5)
    const r = k / view.k
    view = { k, x: cx - (cx - view.x) * r, y: cy - (cy - view.y) * r }
    applyView()
    interacting(true)
  }

  stage.addEventListener('pointerdown', event => {
    dismissHint()
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false, target: event.target, shift: event.shiftKey }
    } else if (pointers.size === 2) {
      const [p, q] = [...pointers.values()]
      pinch = { dist: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 }
      drag = null
    }
  })

  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch !== null && pointers.size >= 2) {
      const [p, q] = [...pointers.values()]
      const dist = Math.hypot(p.x - q.x, p.y - q.y)
      const mx = (p.x + q.x) / 2
      const my = (p.y + q.y) / 2
      finishAnim()
      view = { ...view, x: view.x + (mx - pinch.mx), y: view.y + (my - pinch.my) }
      zoomAt(mx, my, dist / pinch.dist)
      pinch = { dist, mx, my }
      userMoved = true

      return
    }
    if (drag === null || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true
      finishAnim()
      drag.vx = view.x
      drag.vy = view.y
      drag.x = event.clientX
      drag.y = event.clientY
      stage.setPointerCapture(event.pointerId)
      stage.classList.add('panning')
      hideTip()

      return
    }
    if (drag.moved) {
      view = { ...view, x: drag.vx + dx, y: drag.vy + dy }
      userMoved = true
      applyView()
      interacting(false)
    }
  })

  function release(event, isCancel) {
    const wasDrag = drag !== null && drag.id === event.pointerId ? drag : null
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinch = null
    if (wasDrag === null) return
    drag = null
    stage.classList.remove('panning')
    if (!wasDrag.moved && !isCancel) clickAt(wasDrag.target, wasDrag.shift)
  }
  stage.addEventListener('pointerup', event => release(event, false))
  stage.addEventListener('pointercancel', event => release(event, true))

  function clickAt(target, isShift) {
    if (!(target instanceof Element) || target.closest('.hit')) return
    const el = target.closest('.card')
    if (el === null) {
      closePanel()

      return
    }
    if (el.classList.contains('leaving')) return
    if (target.closest('.info')) openPanel(el.dataset.id)
    else cardClick(el.dataset.id, isShift)
  }

  stage.addEventListener(
    'wheel',
    event => {
      event.preventDefault()
      dismissHint()
      finishAnim()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * unit * 0.0085))
      } else {
        view = { ...view, x: view.x - event.deltaX * unit, y: view.y - event.deltaY * unit }
        applyView()
        interacting(false)
      }
      userMoved = true
    },
    { passive: false },
  )

  // Il pizzico del trackpad su Safari.
  let gestureStart = 1
  stage.addEventListener('gesturestart', event => {
    event.preventDefault()
    gestureStart = view.k
  })
  stage.addEventListener('gesturechange', event => {
    event.preventDefault()
    finishAnim()
    zoomAt(event.clientX, event.clientY, (gestureStart * event.scale) / view.k)
    userMoved = true
  })

  cardsEl.addEventListener('mouseover', event => {
    if (drag !== null && drag.moved) return
    const el = event.target.closest ? event.target.closest('.card') : null
    const id = el !== null && !el.classList.contains('leaving') ? el.dataset.id : null
    if (id !== hover) {
      hover = id
      setFocus()
    }
  })
  cardsEl.addEventListener('mouseleave', () => {
    if (hover === null) return
    hover = null
    setFocus()
  })
  cardsEl.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const el = event.target.closest ? event.target.closest('.card') : null
    if (el === null) return
    event.preventDefault()
    cardClick(el.dataset.id, event.shiftKey)
  })

  edgesBase.addEventListener('mouseover', event => {
    if (!event.target.classList || !event.target.classList.contains('hit')) return
    hoverEdge = event.target.dataset.edge
    setFocus()
    showTip(event)
  })
  edgesBase.addEventListener('mousemove', event => {
    if (hoverEdge !== null) moveTip(event)
  })
  edgesBase.addEventListener('mouseout', event => {
    if (!event.target.classList || !event.target.classList.contains('hit')) return
    hoverEdge = null
    setFocus()
    hideTip()
  })

  panel.addEventListener('click', event => {
    if (event.target.closest('.x')) {
      closePanel()

      return
    }
    const go = event.target.closest('[data-go]')
    if (go !== null) {
      goTo(go.dataset.go)

      return
    }
    const row = event.target.closest('.f')
    if (row !== null && !event.target.closest('.fmore')) toggleFile(row)
  })
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.target.closest('input')) return
    const go = event.target.closest('[data-go]')
    const row = event.target.closest('.f')
    if (go === null && row === null) return
    event.preventDefault()
    if (go !== null) goTo(go.dataset.go)
    else toggleFile(row)
  })
  panel.addEventListener('input', event => {
    if (!event.target.classList.contains('filter')) return
    const q = event.target.value.trim().toLowerCase()
    for (const row of panel.querySelectorAll('.files .f')) {
      const file = FILES[Number(row.dataset.file)]
      const isHit = q === '' || file.p.toLowerCase().includes(q) || (file.ex || []).some(name => name.toLowerCase().includes(q))
      row.style.display = isHit ? '' : 'none'
    }
  })

  $('b-open').addEventListener('click', () => setAll(true))
  $('b-close').addEventListener('click', () => setAll(false))
  const zoomBy = factor => {
    const r = safeRect()
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const k = clamp(view.k * factor, 0.08, 2.5)
    const f = k / view.k
    userMoved = true
    goView({ k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f }, 260)
  }
  $('z-in').addEventListener('click', () => zoomBy(1.3))
  pctEl.addEventListener('click', () => zoomBy(1 / view.k))
  $('z-out').addEventListener('click', () => zoomBy(1 / 1.3))
  $('z-fit').addEventListener('click', () => {
    userMoved = false
    goView(fitView(size.w, size.h), 420)
  })

  window.addEventListener('keydown', event => {
    const isTyping = event.target.closest && event.target.closest('input, textarea')
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      search.focus()
      search.select()

      return
    }
    if (isTyping) return
    if (event.key === '/') {
      event.preventDefault()
      search.focus()
    } else if (event.key === 'Escape') {
      if (sheet.classList.contains('on')) openSheet(false)
      else if (prefsEl.classList.contains('on')) openPrefs(false)
      else closePanel()
    } else if (event.key === '?') openSheet(!sheet.classList.contains('on'))
    else if (event.key.toLowerCase() === 'l' && !event.metaKey && !event.ctrlKey) setLevel({ simple: 'normal', normal: 'detail', detail: 'simple' }[level])
    else if (event.key === '1') zoomBy(1 / view.k)
    else if (event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey) setPrefs({ minimap: !prefs.minimap })
    else if (event.key.toLowerCase() === 't' && !event.metaKey && !event.ctrlKey) cycleTheme()
    else if (event.key === '+' || event.key === '=') zoomBy(1.3)
    else if (event.key === '-') zoomBy(1 / 1.3)
    else if (event.key === '0') {
      userMoved = false
      goView(fitView(size.w, size.h), 420)
    }
  })

  window.addEventListener('resize', () => {
    drawMini()
    if (!userMoved && anim === null) {
      view = fitView(size.w, size.h)
      applyView()
      drawEdges()
    }
  })


  // ---------------------------------------------------------------- tema e colore
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
  let kindColors = null
  function applyTheme() {
    const root = document.documentElement
    root.dataset.theme = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : darkQuery.matches ? 'dark' : 'light'
    if (prefs.accent !== 'blue') root.dataset.accent = prefs.accent
    else delete root.dataset.accent
    root.dataset.motion = prefs.motion ? 'on' : 'off'
    kindColors = null
    drawMini()
  }
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', () => prefs.theme === 'auto' && applyTheme())

  // ---------------------------------------------------------------- impostazioni
  const ACCENTS = [['blue', '#0071e3', '#2997ff'], ['purple', '#7d4cdb', '#bf5af2'], ['pink', '#e3306f', '#ff375f'], ['orange', '#e36a00', '#ff9f0a'], ['green', '#1f9d4a', '#30d158'], ['graphite', '#6e6e73', '#98989d']]
  const THEMES = [['auto', 'i-auto', T.themeAuto], ['light', 'i-sun', T.themeLight], ['dark', 'i-moon', T.themeDark]]
  function renderPrefs() {
    const isDark = document.documentElement.dataset.theme === 'dark'
    const toggle = (key, label) =>
      `<div class="row"><span>${esc(label)}</span><button type="button" class="switch${prefs[key] ? ' on' : ''}" data-pref="${key}" role="switch" aria-checked="${prefs[key]}" aria-label="${esc(label)}"></button></div>`
    prefsEl.innerHTML =
      `<div class="mh">${esc(T.appearance)}</div>` +
      `<div class="seg">${THEMES.map(([value, icon, label]) => `<button type="button" data-set-theme="${value}" class="${prefs.theme === value ? 'on' : ''}" aria-pressed="${prefs.theme === value}"><svg class="i"><use href="#${icon}"/></svg>${esc(label)}</button>`).join('')}</div>` +
      `<div class="mh">${esc(T.accent)}</div>` +
      `<div class="sw">${ACCENTS.map(([value, light, dark]) => `<button type="button" data-set-accent="${value}" class="${prefs.accent === value ? 'on' : ''}" style="--c:${isDark ? dark : light}" title="${esc(T.accents[value])}" aria-label="${esc(T.accents[value])}" aria-pressed="${prefs.accent === value}"><svg class="i"><use href="#i-check"/></svg></button>`).join('')}</div>` +
      '<div class="sep"></div>' +
      toggle('minimap', T.minimap) +
      toggle('labels', T.labels) +
      toggle('motion', T.motion) +
      '<div class="sep"></div>' +
      `<button type="button" class="link" data-sheet="1">${esc(T.shortcuts)}<kbd class="k">?</kbd></button>`
  }
  function setPrefs(change) {
    Object.assign(prefs, change)
    savePrefs()
    applyTheme()
    if (prefsEl.classList.contains('on')) renderPrefs()
    drawEdges()
  }
  function openPrefs(isOpen) {
    prefsEl.classList.toggle('on', isOpen)
    prefsBtn.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) renderPrefs()
  }
  prefsBtn.addEventListener('click', () => openPrefs(!prefsEl.classList.contains('on')))
  prefsEl.addEventListener('click', event => {
    const theme = event.target.closest('[data-set-theme]')
    const accent = event.target.closest('[data-set-accent]')
    const pref = event.target.closest('[data-pref]')
    if (theme !== null) setPrefs({ theme: theme.dataset.setTheme })
    else if (accent !== null) setPrefs({ accent: accent.dataset.setAccent })
    else if (pref !== null) setPrefs({ [pref.dataset.pref]: !prefs[pref.dataset.pref] })
    else if (event.target.closest('[data-sheet]')) {
      openPrefs(false)
      openSheet(true)
    }
  })
  document.addEventListener('pointerdown', event => {
    if (prefsEl.classList.contains('on') && !event.target.closest('.menu-wrap')) openPrefs(false)
  })
  pctEl.title = T.actual
  pctEl.setAttribute('aria-label', T.actual)
  prefsBtn.title = T.settings
  prefsBtn.setAttribute('aria-label', T.settings)

  // ---------------------------------------------------------------- minimappa
  const MINI_W = 208
  const MINI_PAD = 10
  const MINI_H = 172
  let mini = { s: 1, ox: 0, oy: 0 }
  const kindColor = kind => {
    if (kindColors === null) {
      kindColors = new Map()
      const probe = document.createElement('i')
      document.body.appendChild(probe)
      for (const one of new Set(D.nodes.map(node => node.kind))) {
        probe.className = `k-${one}`
        kindColors.set(one, getComputedStyle(probe).getPropertyValue('--k').trim() || '#8e8e93')
      }
      probe.remove()
    }

    return kindColors.get(kind) || '#8e8e93'
  }
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath()
    if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
    else g.rect(x, y, w, h)
  }
  // una mappa che sta tutta nella finestra a grandezza vera non ha bisogno della minimappa
  const isBig = () => size.w > window.innerWidth * 0.9 || size.h > (window.innerHeight - 56) * 0.9
  function drawMini() {
    const isOn = prefs.minimap && size.w > 0 && isBig()
    miniEl.classList.toggle('off', !isOn)
    if (!isOn) return
    const s = Math.min((MINI_W - 2 * MINI_PAD) / size.w, (MINI_H - 2 * MINI_PAD) / size.h)
    const h = Math.max(56, Math.round(size.h * s + 2 * MINI_PAD))
    mini = { s, ox: (MINI_W - size.w * s) / 2, oy: (h - size.h * s) / 2 }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (miniC.width !== MINI_W * dpr || miniC.height !== h * dpr) {
      miniC.width = MINI_W * dpr
      miniC.height = h * dpr
      miniC.style.height = `${h}px`
    }
    const g = miniC.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, MINI_W, h)
    for (const [id, f] of curF) {
      if (f.a <= 0.05) continue
      g.globalAlpha = 0.16 * f.a
      g.fillStyle = kindColor(nodeOf(id).kind)
      roundRect(g, mini.ox + f.x * s, mini.oy + f.y * s, f.w * s, f.h * s, 5)
      g.fill()
    }
    for (const [id, v] of cur) {
      if (v.a <= 0.05) continue
      g.globalAlpha = 0.85 * v.a
      g.fillStyle = kindColor(nodeOf(id).kind)
      roundRect(g, mini.ox + v.x * s, mini.oy + v.y * s, Math.max(2.5, v.w * s), Math.max(1.6, v.h * s), 2)
      g.fill()
    }
    g.globalAlpha = 1
    miniView()
  }
  // il riquadro di quello che si vede adesso
  function miniView() {
    if (miniEl.classList.contains('off')) return
    const x0 = clamp(-view.x / view.k, 0, size.w)
    const y0 = clamp((56 - view.y) / view.k, 0, size.h)
    const x1 = clamp((window.innerWidth - view.x) / view.k, 0, size.w)
    const y1 = clamp((window.innerHeight - view.y) / view.k, 0, size.h)
    miniV.style.transform = `translate(${f1(mini.ox + x0 * mini.s)}px, ${f1(mini.oy + y0 * mini.s)}px)`
    miniV.style.width = `${f1(Math.max(6, (x1 - x0) * mini.s))}px`
    miniV.style.height = `${f1(Math.max(6, (y1 - y0) * mini.s))}px`
  }
  // cliccare o trascinare sulla minimappa porta lì la vista
  let miniDrag = null
  function miniGo(event, isFirst) {
    const box = miniC.getBoundingClientRect()
    const wx = clamp((event.clientX - box.left - mini.ox) / mini.s, 0, size.w)
    const wy = clamp((event.clientY - box.top - mini.oy) / mini.s, 0, size.h)
    const r = safeRect()
    const target = { k: view.k, x: r.x + r.w / 2 - wx * view.k, y: r.y + r.h / 2 - wy * view.k }
    userMoved = true
    if (isFirst) {
      goView(target, 300)
    } else {
      finishAnim()
      view = target
      applyView()
      interacting(false)
    }
  }
  miniEl.addEventListener('pointerdown', event => {
    event.preventDefault()
    dismissHint()
    miniDrag = event.pointerId
    miniGo(event, true)
    try {
      miniEl.setPointerCapture(event.pointerId)
    } catch (error) {
      // senza cattura si trascina lo stesso finché il puntatore resta sulla minimappa
    }
  })
  miniEl.addEventListener('pointermove', event => {
    if (miniDrag === event.pointerId) miniGo(event, false)
  })
  for (const type of ['pointerup', 'pointercancel']) {
    miniEl.addEventListener(type, event => {
      if (miniDrag === event.pointerId) miniDrag = null
    })
  }
  miniEl.addEventListener('wheel', event => event.preventDefault(), { passive: false })

  // ---------------------------------------------------------------- scorciatoie
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
  function openSheet(isOpen) {
    if (isOpen) {
      sheet.innerHTML =
        `<div class="box"><h2>${esc(T.shortcuts)}</h2>` +
        T.keys.map(([label, keys]) => `<div class="kb"><span>${esc(label)}</span><span>${keys.map(key => `<kbd class="k">${esc(key === 'MOD' ? MOD : key)}</kbd>`).join('')}</span></div>`).join('') +
        '</div>'
    }
    sheet.classList.toggle('on', isOpen)
  }
  sheet.addEventListener('click', event => {
    if (event.target === sheet) openSheet(false)
  })
  const cycleTheme = () => setPrefs({ theme: { auto: 'light', light: 'dark', dark: 'auto' }[prefs.theme] || 'auto' })

  // ---------------------------------------------------------------- livelli di dettaglio
  const levelsEl = $('lvl')
  function renderLevels() {
    levelsEl.setAttribute('aria-label', T.level)
    levelsEl.innerHTML = T.levels
      .map(([value, label]) => `<button type="button" class="btn${value === level ? ' on' : ''}" data-level="${value}" role="radio" aria-checked="${value === level}">${esc(label)}</button>`)
      .join('')
  }
  function setLevel(next) {
    if (!['simple', 'normal', 'detail'].includes(next) || next === level) return
    finishAnim()
    level = next
    prefs.level = next
    savePrefs()
    for (const el of cards.values()) el.remove()
    cards.clear()
    cur.clear()
    for (const el of frameEls.values()) el.remove()
    frameEls.clear()
    curF.clear()
    for (const id of [...recs.keys()]) dropRec(id)
    model = modelFor(next)
    for (const id of [...expanded]) if (!model.nodes.has(id) || model.nodes.get(id).children.length === 0) expanded.delete(id)
    hover = null
    path = null
    if (selected !== null && !model.nodes.has(selected)) closePanel()
    userMoved = false
    renderLevels()
    relayout({ fit: true })
  }
  levelsEl.addEventListener('click', event => {
    const button = event.target.closest('[data-level]')
    if (button !== null) setLevel(button.dataset.level)
  })

  // ---------------------------------------------------------------- partenza
  level = ['simple', 'normal', 'detail'].includes(prefs.level) ? prefs.level : 'normal'
  model = modelFor(level)
  renderLevels()
  for (const id of load()) if (model.nodes.has(id) && nodeOf(id).children.length > 0) expanded.add(id)
  // un blocco aperto ha senso solo se lo sono anche quelli che lo contengono
  for (const id of [...expanded]) if (model.chain.get(id).slice(1).some(up => !expanded.has(up))) expanded.delete(id)
  if (expanded.size > 0) isHinted = true
  if (isHinted) hint.classList.add('gone')
  applyTheme()
  relayout({ initial: true })
  window.addEventListener('load', () => {
    if (!userMoved && anim === null) {
      view = fitView(size.w, size.h)
      applyView()
      drawEdges()
    }
  })
  window.pharos = {
    toggle,
    goTo,
    goToFile,
    setAll,
    state: () => ({ expanded: [...expanded], view, size, edges: edges.length, routed: routes.size, frames: frames.size }),
    debug: () => ({ isAnimating: anim !== null, isMoving, cur: [...cur.keys()], cards: [...cards.keys()], frames: [...frameEls.keys()], recs: recs.size }),
  }
})()
