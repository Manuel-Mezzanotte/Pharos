// Il layout di Pharos: funzioni pure, usate dalla pagina e dai test.
// Il grafo scorre dall'alto in basso. Un blocco aperto resta una scheda e sotto di
// lei si apre la sua sezione: un riquadro che raccoglie le sue parti, che a loro
// volta possono aprirsi. Ogni gruppo (il primo livello e ogni sezione) si dispone a
// righe, chi usa sopra chi è usato. Le frecce corrono in corsie verticali tra le
// schede e girano ad angolo retto negli spazi tra le righe, ognuna sul suo binario:
// così non passano mai sopra un blocco e non si confondono tra loro.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.PharosLayout = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const SIZE = {
    cardW: 264,
    cardH: 136,
    colGap: 96, // tra i blocchi del primo livello
    rowGap: 120, // tra le righe del primo livello (di più se servono binari)
    partGap: 40, // tra le parti dentro una sezione
    partRowGap: 64,
    headGap: 48, // tra la scheda di una sezione e le sue parti
    padX: 28, // margini della sezione
    padTop: 24,
    padBottom: 28,
    laneGap: 14, // tra due corsie vicine
    laneSide: 24, // tra una corsia e una scheda
    track: 12, // tra due binari nello stesso spazio
    trackPad: 20,
    port: 18, // tra due frecce che escono dallo stesso lato
    isoGap: 160,
  }
  const SIGNIFICANT = 0.3
  const KEEP = 1
  const WRAP = 5 // parti per riga, al massimo, in una sezione
  const ROOT_WRAP = 6

  // La sequenza non decrescente più vicina ai valori dati (pool adjacent violators).
  function isotonic(values) {
    const blocks = []
    for (const value of values) {
      blocks.push({ sum: value, n: 1 })
      while (blocks.length > 1) {
        const last = blocks[blocks.length - 1]
        const before = blocks[blocks.length - 2]
        if (before.sum / before.n <= last.sum / last.n) break
        before.sum += last.sum
        before.n += last.n
        blocks.pop()
      }
    }
    const out = []
    for (const block of blocks) for (let k = 0; k < block.n; k += 1) out.push(block.sum / block.n)

    return out
  }

  const push = (map, key, value) => {
    const list = map.get(key)
    if (list === undefined) map.set(key, [value])
    else list.push(value)
  }

  // ------------------------------------------------------------ il modello

  function buildModel(data) {
    const nodes = new Map(data.nodes.map(node => [node.id, node]))
    const chain = new Map()
    const climb = id => {
      if (chain.has(id)) return chain.get(id)
      const node = nodes.get(id)
      const up = node.parent ? [id, ...climb(node.parent)] : [id]
      chain.set(id, up)

      return up
    }
    for (const id of nodes.keys()) climb(id)

    return { nodes, roots: data.roots, edges: data.edges, chain }
  }

  function isAncestor(model, ancestor, id) {
    return ancestor !== id && model.chain.get(id).includes(ancestor)
  }

  function isOpen(model, expanded, id) {
    return expanded.has(id) && (model.nodes.get(id).children || []).length > 0
  }

  // Il blocco che si vede al posto di `id`: lui, o il suo antenato chiuso.
  function repOf(model, id, expanded) {
    const up = model.chain.get(id)
    let i = up.length - 1
    while (i > 0 && expanded.has(up[i])) i -= 1

    return up[i]
  }

  // I nodi visibili, in ordine: ogni blocco seguito dalle sue parti aperte.
  function visibleIds(model, expanded) {
    const out = []
    const visit = id => {
      out.push(id)
      if (isOpen(model, expanded, id)) for (const child of model.nodes.get(id).children) visit(child)
    }
    for (const id of model.roots) visit(id)

    return out
  }

  function heaviest(labels) {
    let best
    let weight = -1
    for (const [label, w] of labels) {
      if (w > weight) {
        best = label
        weight = w
      }
    }

    return best
  }

  // I collegamenti come si vedono adesso: ognuno sale al nodo visibile più vicino,
  // quelli dentro un blocco chiuso spariscono, quelli doppi si sommano e due
  // frecce opposte diventano una sola a doppia punta.
  function liftEdges(model, expanded) {
    const groups = new Map()
    for (const edge of model.edges) {
      const a = repOf(model, edge.a, expanded)
      const b = repOf(model, edge.b, expanded)
      if (a === b || isAncestor(model, a, b) || isAncestor(model, b, a)) continue
      const key = `${a}\u0000${b}`
      let group = groups.get(key)
      if (group === undefined) {
        group = { a, b, w: 0, labels: new Map(), soft: true, declared: true, named: false, kept: null, count: 0 }
        groups.set(key, group)
      }
      group.w += edge.w
      group.count += 1
      // nominato a questo livello: Claude ha scritto il nome proprio per questi due blocchi
      if (edge.label && (edge.lf === undefined || (edge.lf === a && edge.lt === b) || (edge.lf === b && edge.lt === a))) group.named = true
      // nominato più in alto, tra due blocchi ora aperti: la freccia resta in vista, senza nome
      else if (edge.label && edge.lf !== undefined && (edge.lf === a || isAncestor(model, edge.lf, a)) && (edge.lt === b || isAncestor(model, edge.lt, b))) group.kept = `${edge.lf}>${edge.lt}`
      if (!edge.soft) group.soft = false
      if (!edge.declared) group.declared = false
      if (edge.label) group.labels.set(edge.label, (group.labels.get(edge.label) || 0) + edge.w)
    }
    const out = []
    const done = new Set()
    for (const [key, group] of groups) {
      if (done.has(key)) continue
      done.add(key)
      const backKey = `${group.b}\u0000${group.a}`
      const back = groups.get(backKey)
      if (back === undefined) {
        out.push({
          id: `${group.a}>${group.b}`,
          a: group.a,
          b: group.b,
          w: group.w,
          count: group.count,
          label: heaviest(group.labels),
          named: group.named,
          kept: group.kept,
          soft: group.soft,
          declared: group.declared,
          bidir: false,
        })
        continue
      }
      done.add(backKey)
      const main = back.w > group.w ? back : group
      const other = main === group ? back : group
      out.push({
        id: `${main.a}>${main.b}`,
        a: main.a,
        b: main.b,
        w: group.w + back.w,
        count: group.count + back.count,
        label: heaviest(main.labels) ?? heaviest(other.labels),
        named: group.named || back.named,
        kept: group.kept ?? back.kept,
        soft: group.soft && back.soft,
        declared: group.declared && back.declared,
        bidir: true,
      })
    }

    // Quali si vedono sempre e quali solo passandoci sopra: restano quelli che Claude
    // ha nominato a questo livello o scritto (anche verso utilità e test), e quelli
    // del codice che pesano almeno il 30% del collegamento più forte di uno dei due
    // blocchi. Gli altri (utilità, test, quelli deboli) riempirebbero tutto di fili.
    // di un collegamento nominato più in alto resta in vista solo la freccia più forte:
    // basta a tenere i blocchi al loro posto, e tutte insieme farebbero un groviglio
    const keptBest = new Map()
    for (const edge of out) {
      if (edge.kept === null || edge.named) continue
      const best = keptBest.get(edge.kept)
      if (best === undefined || edge.w > best.w) keptBest.set(edge.kept, edge)
    }
    for (const edge of out) edge.kept = edge.kept !== null && keptBest.get(edge.kept) === edge
    const strongest = new Map()
    for (const edge of out) {
      if (edge.soft) continue
      strongest.set(edge.a, Math.max(strongest.get(edge.a) || 0, edge.w))
      strongest.set(edge.b, Math.max(strongest.get(edge.b) || 0, edge.w))
    }
    for (const edge of out) {
      const scale = Math.min(strongest.get(edge.a) || 0, strongest.get(edge.b) || 0)
      edge.minor = !edge.named && !edge.kept && !edge.declared && (edge.soft || edge.w < SIGNIFICANT * scale)
    }
    // ...e di quelli del codice ogni blocco tiene in vista solo i 2 più forti che
    // partono da lui o i 2 più forti che gli arrivano
    const plain = out.filter(edge => !edge.minor && !edge.named && !edge.kept && !edge.declared).sort((x, y) => y.w - x.w)
    const fromCount = new Map()
    const toCount = new Map()
    for (const edge of plain) {
      const isTopOut = (fromCount.get(edge.a) || 0) < KEEP
      const isTopIn = (toCount.get(edge.b) || 0) < KEEP
      fromCount.set(edge.a, (fromCount.get(edge.a) || 0) + 1)
      toCount.set(edge.b, (toCount.get(edge.b) || 0) + 1)
      if (!isTopOut && !isTopIn) edge.minor = true
    }

    return out
  }

  // I due figli del più basso antenato comune (serve al pannello dei dettagli).
  function commonParent(model, a, b) {
    const up = model.chain.get(a).slice().reverse()
    const down = model.chain.get(b).slice().reverse()
    let i = 0
    while (i < up.length && i < down.length && up[i] === down[i]) i += 1

    return { parent: i > 0 ? up[i - 1] : '', first: up[i], second: down[i] }
  }

  // ------------------------------------------------------------ le righe

  // Ogni elemento riceve una riga: chi usa sta sopra chi è usato. I cicli si
  // rompono girando un arco; chi non è usato da nessuno scende fin sopra chi usa.
  function rank(count, links) {
    const out = Array.from({ length: count }, () => [])
    const inn = new Array(count).fill(0)
    links.forEach((link, i) => {
      link.reversed = false
      out[link.u].push(i)
      inn[link.v] += 1
    })
    const state = new Array(count).fill(0)
    const visit = x => {
      state[x] = 1
      for (const i of out[x]) {
        const y = links[i].v
        if (state[y] === 1) links[i].reversed = true
        else if (state[y] === 0) visit(y)
      }
      state[x] = 2
    }
    const starts = [...Array(count).keys()].sort((x, y) => Number(inn[x] > 0) - Number(inn[y] > 0) || x - y)
    for (const x of starts) if (state[x] === 0) visit(x)

    const preds = Array.from({ length: count }, () => [])
    const succs = Array.from({ length: count }, () => [])
    for (const link of links) {
      const [top, bottom] = link.reversed ? [link.v, link.u] : [link.u, link.v]
      succs[top].push(bottom)
      preds[bottom].push(top)
    }
    const row = new Array(count).fill(-1)
    const rowOf = x => {
      if (row[x] >= 0) return row[x]
      row[x] = 0
      row[x] = preds[x].length > 0 ? Math.max(...preds[x].map(rowOf)) + 1 : 0

      return row[x]
    }
    for (let x = 0; x < count; x += 1) rowOf(x)
    for (let x = 0; x < count; x += 1) {
      if (preds[x].length === 0 && succs[x].length > 0) row[x] = Math.min(...succs[x].map(y => row[y])) - 1
    }
    const used = [...new Set(row)].sort((a, b) => a - b)

    return row.map(r => used.indexOf(r))
  }

  // Le righe con troppi elementi vanno a capo: legami invisibili spingono gli ultimi
  // sotto i primi, in righe di lunghezza simile (10 parti: due righe da 5).
  function rankWrapped(count, links, wrap) {
    const extra = []
    let row = []
    for (let round = 0; round < 8; round += 1) {
      row = rank(count, [...links, ...extra])
      const byRow = new Map()
      for (let i = 0; i < count; i += 1) push(byRow, row[i], i)
      let isWrapped = false
      for (const list of byRow.values()) {
        if (list.length <= wrap) continue
        const per = Math.ceil(list.length / Math.ceil(list.length / wrap))
        for (let k = per; k < list.length; k += 1) extra.push({ u: list[k - per], v: list[k], isHidden: true })
        isWrapped = true
      }
      if (!isWrapped) break
    }

    return { row, extra }
  }

  // L'ordine dentro ogni riga: il baricentro dei vicini, avanti e indietro, e poi
  // scambi tra vicini; si tiene l'ordine con meno incroci.
  function orderRows(rows, elems, segs) {
    const up = elems.map(() => [])
    const down = elems.map(() => [])
    for (const seg of segs) {
      down[seg.a].push(seg)
      up[seg.b].push(seg)
    }
    const pos = new Array(elems.length).fill(0)
    const settle = list => list.forEach((k, j) => (pos[k] = j))
    for (const list of rows) list.sort((a, b) => elems[a].seed - elems[b].seed || a - b)
    rows.forEach(settle)

    const crossings = r => {
      if (r < 0 || r + 1 >= rows.length) return 0
      const pairs = []
      for (const k of rows[r]) for (const seg of down[k]) if (!seg.isHidden) pairs.push([pos[k], pos[seg.b], seg.weight])
      let total = 0
      for (let i = 0; i < pairs.length; i += 1) {
        for (let j = i + 1; j < pairs.length; j += 1) {
          if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) total += pairs[i][2] * pairs[j][2]
        }
      }

      return total
    }
    const allCrossings = () => rows.reduce((sum, _, r) => sum + crossings(r), 0)

    let best = rows.map(list => list.slice())
    let bestScore = allCrossings()
    for (let sweep = 0; sweep < 14 && bestScore > 0; sweep += 1) {
      const isDown = sweep % 2 === 0
      const seq = rows.map((_, r) => r)
      if (!isDown) seq.reverse()
      for (const r of seq) {
        const list = rows[r]
        const key = new Map()
        for (const k of list) {
          const near = isDown ? up[k].map(seg => [pos[seg.a], seg.weight]) : down[k].map(seg => [pos[seg.b], seg.weight])
          const weight = near.reduce((sum, [, w]) => sum + w, 0)
          key.set(k, weight > 0 ? near.reduce((sum, [p, w]) => sum + p * w, 0) / weight : pos[k])
        }
        list.sort((a, b) => key.get(a) - key.get(b) || pos[a] - pos[b])
        settle(list)
      }
      const score = allCrossings()
      if (score < bestScore) {
        bestScore = score
        best = rows.map(list => list.slice())
      }
    }
    best.forEach((list, r) => {
      rows[r] = list
      settle(list)
    })
    if (elems.length <= 500 && bestScore > 0) {
      for (let pass = 0; pass < 4; pass += 1) {
        let isBetter = false
        for (let r = 0; r < rows.length; r += 1) {
          const list = rows[r]
          for (let j = 0; j + 1 < list.length; j += 1) {
            const before = crossings(r - 1) + crossings(r)
            ;[list[j], list[j + 1]] = [list[j + 1], list[j]]
            settle(list)
            if (crossings(r - 1) + crossings(r) < before) isBetter = true
            else {
              ;[list[j], list[j + 1]] = [list[j + 1], list[j]]
              settle(list)
            }
          }
        }
        if (!isBetter) break
      }
    }

    return { pos, up, down }
  }

  // I binari di uno spazio tra due righe: ogni freccia che cambia corsia scende, corre in
  // orizzontale sul suo binario e riscende. Le frecce che si uniscono o si dividono nello
  // stesso punto stanno sullo stesso binario (una sbarra, come in un organigramma). Tra due
  // binari che si sovrappongono sta sopra quello che fa meno incroci.
  function assignTracks(items) {
    const n = items.length
    const lo = items.map(t => Math.min(...t.starts, ...t.ends))
    const hi = items.map(t => Math.max(...t.starts, ...t.ends))
    const count = (list, i) => list.reduce((sum, x) => sum + Number(x > lo[i] + 0.5 && x < hi[i] - 0.5), 0)
    const above = Array.from({ length: n }, () => [])
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (lo[i] > hi[j] + SIZE.laneGap || lo[j] > hi[i] + SIZE.laneGap) continue
        const iFirst = count(items[i].ends, j) + count(items[j].starts, i)
        const jFirst = count(items[j].ends, i) + count(items[i].starts, j)
        const isIFirst = iFirst < jFirst || (iFirst === jFirst && (lo[i] - lo[j] || i - j) < 0)
        if (isIFirst) above[j].push(i)
        else above[i].push(j)
      }
    }
    const track = new Array(n).fill(-1)
    const state = new Array(n).fill(0)
    const depth = i => {
      if (state[i] === 2) return track[i]
      if (state[i] === 1) return -1
      state[i] = 1
      let t = 0
      for (const j of above[i]) t = Math.max(t, depth(j) + 1)
      state[i] = 2
      track[i] = t

      return t
    }
    let total = 0
    for (let i = 0; i < n; i += 1) {
      items[i].track = depth(i)
      total = Math.max(total, items[i].track + 1)
    }

    return total
  }

  // La sequenza più vicina ai valori dati che tiene almeno `gap` tra un valore e il successivo.
  const spaced = (values, gap) => isotonic(values.map((v, i) => v - i * gap)).map((v, i) => v + i * gap)

  // ------------------------------------------------------------ tutto il grafo

  const HEAD = '\u0000head'

  // Dà a ogni scheda visibile la sua cornice { x, y, w, h, depth, isOpen }, a ogni blocco
  // aperto il riquadro della sua sezione e a ogni collegamento sempre in vista la spezzata
  // per cui passa, dal blocco in alto a quello in basso. Le frecce tra gli stessi due
  // blocchi di un gruppo corrono insieme in una sola corsia: si uniscono uscendo da una
  // sezione e si dividono entrando nell'altra.
  function layout(model, expanded, edges) {
    const S = SIZE
    const ids = visibleIds(model, expanded)
    const visible = new Set(ids)
    const open = id => isOpen(model, expanded, id)
    const parentOf = id => model.nodes.get(id).parent || ''
    const itemsOf = g => (g === '' ? model.roots : model.nodes.get(g).children)
    const depthOf = id => (id === '' ? -1 : model.chain.get(id).length - 1)
    const itemIn = (g, x) => {
      let at = x
      while (parentOf(at) !== g) at = parentOf(at)

      return at
    }
    const commonGroup = (a, b) => {
      const above = new Set(model.chain.get(b).slice(1))
      for (const up of model.chain.get(a).slice(1)) if (above.has(up)) return up

      return ''
    }

    // le corsie: una per ogni coppia di blocchi di un gruppo che si parlano
    const bundles = new Map()
    const bundlesIn = new Map()
    const routed = []
    for (const edge of edges) {
      if (edge.minor || !visible.has(edge.a) || !visible.has(edge.b)) continue
      const g = commonGroup(edge.a, edge.b)
      const U = itemIn(g, edge.a)
      const V = itemIn(g, edge.b)
      const [p, q] = U < V ? [U, V] : [V, U]
      // una freccia che arriva alla scheda di un blocco aperto ha la sua corsia
      const key = open(edge.a) || open(edge.b) ? `${g}|${p}|${q}|${edge.id}` : `${g}|${p}|${q}`
      let bundle = bundles.get(key)
      if (bundle === undefined) {
        bundle = { key, g, p, q, forward: 0, back: 0, edges: [] }
        bundles.set(key, bundle)
        push(bundlesIn, g, bundle)
      }
      if (U === p) bundle.forward += edge.w
      else bundle.back += edge.w
      bundle.edges.push(edge)
      routed.push({ edge, bundle })
    }

    // 1. le righe di ogni gruppo, e quale blocco di ogni corsia sta in alto
    const groups = ['', ...ids.filter(open)]
    const ranks = new Map()
    for (const g of groups) {
      const items = itemsOf(g)
      const mine = bundlesIn.get(g) || []
      const linked = new Set()
      for (const bundle of mine) {
        linked.add(bundle.p)
        linked.add(bundle.q)
      }
      const main = g === '' ? items.filter(id => linked.has(id)) : items.slice()
      const alone = g === '' ? items.filter(id => !linked.has(id)) : []
      const index = new Map(main.map((id, i) => [id, i]))
      const links = mine.map(bundle => {
        const [from, to] = bundle.forward >= bundle.back ? [bundle.p, bundle.q] : [bundle.q, bundle.p]

        return { bundle, from, to, u: index.get(from), v: index.get(to) }
      })
      const { row, extra } = rankWrapped(main.length, links, g === '' ? ROOT_WRAP : WRAP)
      for (const link of links) {
        link.bundle.top = link.reversed ? link.to : link.from
        link.bundle.bottom = link.reversed ? link.from : link.to
        link.bundle.weight = 1 + Math.log2(1 + link.bundle.forward + link.bundle.back) / 3
      }
      ranks.set(g, {
        main,
        alone,
        order: new Map(items.map((id, i) => [id, i])),
        row: new Map(main.map((id, i) => [id, row[i]])),
        extra: extra.map(link => ({ u: main[link.u], v: main[link.v] })),
      })
    }

    // 2. ogni freccia esce dal fondo delle sezioni che contengono il suo capo in alto ed
    // entra dalla cima di quelle del capo in basso; in ogni sezione, quelle della stessa
    // corsia hanno una sola uscita (o entrata)
    const outs = new Map()
    const ins = new Map()
    const group = (map, section, key) => {
      let byKey = map.get(section)
      if (byKey === undefined) {
        byKey = new Map()
        map.set(section, byKey)
      }
      let set = byKey.get(key)
      if (set === undefined) {
        set = new Set()
        byKey.set(key, set)
      }

      return set
    }
    for (const one of routed) {
      const { edge, bundle } = one
      one.top = itemIn(bundle.g, edge.a) === bundle.top ? edge.a : edge.b
      one.bottom = one.top === edge.a ? edge.b : edge.a
      one.outs = []
      one.ins = []
      for (const c of model.chain.get(one.top)) {
        if (c === bundle.g) break
        if (!open(c)) continue
        const el = c === one.top ? HEAD : itemIn(c, one.top)
        one.outs.push({ section: c, el })
        group(outs, c, bundle.key).add(el)
      }
      for (const c of model.chain.get(one.bottom)) {
        if (c === bundle.g) break
        if (!open(c)) continue
        const el = c === one.bottom ? HEAD : itemIn(c, one.bottom)
        one.ins.unshift({ section: c, el })
        group(ins, c, bundle.key).add(el)
      }
    }

    // 3. ogni gruppo si dispone dopo le sezioni che contiene
    const placed = new Map()
    const sizeOf = id => (open(id) ? { w: placed.get(id).w, h: placed.get(id).h } : { w: S.cardW, h: S.cardH })
    for (const g of groups.slice().sort((x, y) => depthOf(y) - depthOf(x))) placed.set(g, arrange(g))

    function arrange(g) {
      const isRoot = g === ''
      const info = ranks.get(g)
      const off = isRoot ? 0 : 1
      const myOuts = outs.get(g) || new Map()
      const myIns = ins.get(g) || new Map()
      const elems = []
      const add = elem => elems.push(elem) - 1
      const elOf = new Map()
      const head = isRoot ? -1 : add({ kind: 'head', id: g, r: 0, w: S.cardW, h: S.cardH, seed: 0 })
      for (const id of info.main) {
        const size = sizeOf(id)
        elOf.set(id, add({ kind: 'item', id, r: info.row.get(id) + off, w: size.w, h: size.h, seed: info.order.get(id) }))
      }
      const lastRow = Math.max(off - 1, ...info.main.map(id => info.row.get(id) + off))
      const hasFoot = myOuts.size > 0
      const footRow = lastRow + 1
      const rowCount = hasFoot ? footRow + 1 : lastRow + 1
      const elFor = el => (el === HEAD ? head : elOf.get(el))

      // le catene: da un elemento a un altro attraverso le righe, con un punto (fantasma) per riga
      const segs = []
      const chains = new Map()
      const ghost = (r, seed) => add({ kind: 'ghost', r, w: 0, h: 0, seed })
      const chain = (id, key, weight, from, fromRow, toRow, to, seed, isFromTop) => {
        const els = []
        if (from >= 0) els.push(from)
        for (let r = fromRow + 1; r < toRow; r += 1) els.push(ghost(r, seed))
        if (to >= 0) els.push(to)
        const one = { id, key, els, segs: [], isFromTop }
        for (let i = 0; i + 1 < els.length; i += 1) {
          const seg = { a: els[i], b: els[i + 1], weight: weight * (elems[els[i]].kind === 'ghost' ? 1.5 : 1), key }
          segs.push(seg)
          one.segs.push(seg)
        }
        chains.set(id, one)

        return one
      }
      for (const bundle of bundlesIn.get(g) || []) {
        const top = elOf.get(bundle.top)
        const bottom = elOf.get(bundle.bottom)
        chain(`m|${bundle.key}`, bundle.key, bundle.weight, top, elems[top].r, elems[bottom].r, bottom, (elems[top].seed + elems[bottom].seed) / 2)
      }
      const weightOf = key => bundles.get(key).weight
      const seedOf = list => list.reduce((sum, k) => sum + elems[k].seed, 0) / Math.max(1, list.length)
      // le uscite: le parti di una riga si uniscono subito sotto di lei, e la linea unita
      // scende a unirsi con quelle della riga dopo, fino al fondo della sezione
      const outIds = new Map()
      for (const [key, sources] of myOuts) {
        const weight = weightOf(key)
        const byRow = new Map()
        for (const el of sources) push(byRow, elems[elFor(el)].r, el)
        const order = [...byRow.keys()].sort((x, y) => x - y)
        const carried = []
        const starts = []
        let carry = -1
        let carryRow = -1
        for (const [i, r] of order.entries()) {
          const here = byRow.get(r).map(elFor)
          const seed = seedOf(carry >= 0 ? [...here, carry] : here)
          const joint = ghost(r + 1, seed)
          if (carry >= 0) {
            chain(`c|${key}|${i}`, key, weight, carry, carryRow, r + 1, joint, seed)
            carried.push(`c|${key}|${i}`)
          }
          for (const el of byRow.get(r)) {
            chain(`o|${key}|${el}`, key, weight, elFor(el), r, r + 1, joint, seed)
            starts.push([el, i])
          }
          carry = joint
          carryRow = r + 1
        }
        if (carryRow < footRow) chain(`t|${key}`, key, weight, carry, carryRow, footRow + 1, -1, elems[carry].seed)
        else chains.set(`t|${key}`, { id: `t|${key}`, key, els: [carry], segs: [] })
        for (const [el, i] of starts) outIds.set(`${key}|${el}`, [`o|${key}|${el}`, ...carried.slice(i), `t|${key}`])
      }
      // le entrate, al contrario: una linea scende dalla cima e si divide sopra ogni riga di parti
      const inIds = new Map()
      for (const [key, targets] of myIns) {
        const weight = weightOf(key)
        const list = [...targets]
        if (list.length === 1 && list[0] === HEAD) {
          chains.set(`T|${key}`, { id: `T|${key}`, key, els: [head], segs: [], isFromTop: true, isHead: true })
          inIds.set(`${key}|${HEAD}`, [`T|${key}`])
          continue
        }
        const byRow = new Map()
        for (const el of list) push(byRow, elems[elFor(el)].r, el)
        const order = [...byRow.keys()].sort((x, y) => x - y)
        const carried = [`T|${key}`]
        let fork = -1
        for (const [i, r] of order.entries()) {
          const here = byRow.get(r).map(elFor)
          const seed = seedOf(here)
          const next = ghost(r - 1, seed)
          if (fork < 0) chain(`T|${key}`, key, weight, -1, -1, r - 1, next, seed, true)
          else {
            chain(`C|${key}|${i}`, key, weight, fork, elems[fork].r, r - 1, next, seed)
            carried.push(`C|${key}|${i}`)
          }
          for (const el of byRow.get(r)) {
            chain(`i|${key}|${el}`, key, weight, next, r - 1, r, elFor(el), seed)
            inIds.set(`${key}|${el}`, [...carried, `i|${key}|${el}`])
          }
          fork = next
        }
      }
      // legami invisibili: le righe andate a capo stanno in colonna, la scheda sopra le sue parti
      if (!isRoot) {
        const first = info.main.filter(id => info.row.get(id) === 0)
        elems[head].seed = first.reduce((sum, id) => sum + info.order.get(id), 0) / Math.max(1, first.length)
        for (const id of first) segs.push({ a: head, b: elOf.get(id), weight: 2 / first.length, isHidden: true })
      }
      for (const link of info.extra) {
        const a = elOf.get(link.u)
        const b = elOf.get(link.v)
        if (elems[b].r === elems[a].r + 1) segs.push({ a, b, weight: 0.8, isHidden: true })
      }

      const rows = Array.from({ length: rowCount }, () => [])
      elems.forEach((elem, k) => rows[elem.r].push(k))
      const { pos, up, down } = orderRows(rows, elems, segs)

      // le porte: dove ogni freccia tocca una scheda, allargate dal centro nell'ordine dei
      // vicini; su una sezione chiusa dentro questa sono dove escono o entrano le sue corsie
      const spread = (count, w) => {
        const inset = Math.min(36, w * 0.16)
        const step = count > 1 ? Math.min(S.port, (w - 2 * inset) / (count - 1)) : 0

        return Array.from({ length: count }, (_, i) => Math.round(w / 2 + (i - (count - 1) / 2) * step))
      }
      const headTop = [...chains.values()].filter(one => one.isHead)
      for (const [k, elem] of elems.entries()) {
        const downs = down[k].filter(seg => !seg.isHidden)
        const ups = up[k].filter(seg => !seg.isHidden)
        if (elem.kind === 'ghost') {
          for (const seg of downs) seg.offA = 0
          for (const seg of ups) seg.offB = 0
        } else if (elem.kind === 'item' && open(elem.id)) {
          const sub = placed.get(elem.id)
          for (const seg of downs) seg.offA = sub.exitX.get(seg.key)
          for (const seg of ups) seg.offB = sub.entryX.get(seg.key)
        } else {
          downs.sort((p, q) => pos[p.b] - pos[q.b] || (p.key < q.key ? -1 : 1))
          spread(downs.length, elem.w).forEach((x, i) => (downs[i].offA = x))
          ups.sort((p, q) => pos[p.a] - pos[q.a] || (p.key < q.key ? -1 : 1))
          const tops = [...ups, ...(k === head ? headTop : [])]
          spread(tops.length, elem.w).forEach((x, i) => (tops[i].els === undefined ? (tops[i].offB = x) : (tops[i].topOff = x)))
        }
      }
      for (const seg of segs) {
        if (!seg.isHidden) continue
        seg.offA = elems[seg.a].w / 2
        seg.offB = elems[seg.b].w / 2
      }

      const left = new Array(elems.length).fill(0)
      if (isRoot) placeFree(rows, elems, up, down, left)
      else placeGrid(rows, elems, up, head, left)
      const pad = isRoot ? 0 : S.padX
      const minX = Math.min(...elems.map((_, k) => left[k]))
      let w = 0
      for (let k = 0; k < elems.length; k += 1) {
        left[k] = Math.round(left[k] + pad - minX)
        w = Math.max(w, left[k] + elems[k].w)
      }
      w += pad

      // i binari di ogni spazio tra due righe, e da lì l'altezza di ogni spazio
      const portX = (seg, end) => (end === 'a' ? left[seg.a] + seg.offA : left[seg.b] + seg.offB)
      const turns = rows.map(() => new Map())
      for (const seg of segs) {
        if (seg.isHidden) continue
        seg.y = undefined
        const x1 = portX(seg, 'a')
        const x2 = portX(seg, 'b')
        if (Math.abs(x1 - x2) <= 0.5) continue
        const isMerge = elems[seg.b].kind === 'ghost' && up[seg.b].length > 1
        const isSplit = elems[seg.a].kind === 'ghost' && down[seg.a].length > 1
        const key = isMerge ? `m${seg.b}` : isSplit ? `s${seg.a}` : `x${segs.indexOf(seg)}`
        let item = turns[elems[seg.a].r].get(key)
        if (item === undefined) {
          item = { starts: [], ends: [], segs: [] }
          turns[elems[seg.a].r].set(key, item)
        }
        item.starts.push(x1)
        item.ends.push(x2)
        item.segs.push(seg)
      }
      const rowH = rows.map(list => Math.max(0, ...list.map(k => elems[k].h)))
      const counts = turns.map(map => assignTracks([...map.values()]))
      const gapH = rows.map((_, r) => {
        const need = counts[r] > 0 ? (counts[r] - 1) * S.track + 2 * S.trackPad : 0
        const least = isRoot ? S.rowGap : r === 0 ? S.headGap : hasFoot && r === footRow - 1 ? 0 : S.partRowGap

        return Math.max(least, need)
      })
      const rowTop = []
      let y = isRoot ? 0 : S.padTop
      for (let r = 0; r < rows.length; r += 1) {
        rowTop.push(y)
        y += rowH[r] + gapH[r]
      }
      rows.forEach((_, r) => {
        const start = rowTop[r] + rowH[r] + (gapH[r] - (counts[r] - 1) * S.track) / 2
        for (const item of turns[r].values()) for (const seg of item.segs) seg.y = start + item.track * S.track
      })
      const last = rows.length - 1
      const h = isRoot ? (info.main.length > 0 ? rowTop[last] + rowH[last] : 0) : (hasFoot ? rowTop[footRow] : rowTop[last] + rowH[last]) + S.padBottom

      // i pezzi di strada dentro questo gruppo
      const pieces = new Map()
      const exitX = new Map()
      const entryX = new Map()
      for (const one of chains.values()) {
        const pts = []
        let x
        if (one.isHead) {
          x = left[head] + one.topOff
          pts.push({ x, y: 0 }, { x, y: rowTop[0] })
        } else if (one.isFromTop) {
          x = left[one.els[0]]
          pts.push({ x, y: 0 })
        } else if (one.segs.length > 0) {
          const first = elems[one.els[0]]
          x = portX(one.segs[0], 'a')
          pts.push({ x, y: rowTop[first.r] + first.h })
        } else {
          x = left[one.els[0]]
          pts.push({ x, y: rowTop[elems[one.els[0]].r] })
        }
        for (const seg of one.segs) {
          const x2 = portX(seg, 'b')
          if (seg.y !== undefined) pts.push({ x, y: seg.y }, { x: x2, y: seg.y })
          x = x2
          pts.push({ x, y: rowTop[elems[seg.b].r] })
        }
        if (one.isFromTop) entryX.set(one.key, pts[0].x)
        if (one.id.startsWith('t|')) {
          exitX.set(one.key, x)
          pts.push({ x, y: h })
        }
        pieces.set(one.id, pts)
      }

      const at = new Map()
      for (const [id, k] of elOf) at.set(id, { x: left[k], y: rowTop[elems[k].r] })

      return { w: info.main.length > 0 || !isRoot ? w : 0, h, pos: at, head: head >= 0 ? { x: left[head], y: rowTop[0] } : null, exitX, entryX, pieces, outIds, inIds }
    }

    // Le x del primo livello: ogni elemento si avvicina ai vicini (porta contro porta)
    // senza scavalcarne altri, così le corsie vengono dritte.
    function placeFree(rows, elems, up, down, left) {
      const gapOf = (p, q) => {
        const kinds = [elems[p].kind, elems[q].kind]
        if (kinds[0] === 'ghost' && kinds[1] === 'ghost') return S.laneGap
        if (kinds[0] === 'ghost' || kinds[1] === 'ghost') return S.laneSide

        return S.colGap
      }
      const rowWidth = list => list.reduce((sum, k, j) => sum + elems[k].w + (j > 0 ? gapOf(list[j - 1], k) : 0), 0)
      const widest = Math.max(0, ...rows.map(rowWidth))
      for (const list of rows) {
        let at = (widest - rowWidth(list)) / 2
        list.forEach((k, j) => {
          if (j > 0) at += gapOf(list[j - 1], k)
          left[k] = at
          at += elems[k].w
        })
      }
      for (let pass = 0; pass < 14; pass += 1) {
        const seq = rows.map((_, r) => r)
        if (pass % 2 === 1) seq.reverse()
        for (const r of seq) {
          const list = rows[r]
          const wanted = list.map(k => {
            let sum = 0
            let weight = 0
            for (const seg of up[k]) {
              sum += (left[seg.a] + seg.offA - seg.offB) * seg.weight
              weight += seg.weight
            }
            for (const seg of down[k]) {
              sum += (left[seg.b] + seg.offB - seg.offA) * seg.weight
              weight += seg.weight
            }

            return weight > 0 ? sum / weight : left[k]
          })
          let used = 0
          const offset = list.map((k, j) => {
            if (j > 0) used += elems[list[j - 1]].w + gapOf(list[j - 1], k)

            return used
          })
          const settled = isotonic(wanted.map((value, j) => value - offset[j]))
          list.forEach((k, j) => (left[k] = Math.round(settled[j] + offset[j])))
        }
      }
    }

    // Le x dentro una sezione: le parti su una griglia, colonne allineate da una riga
    // all'altra; le corsie passano negli spazi tra le colonne, che si allargano se ne
    // passano tante. La scheda del blocco sta al centro, in cima.
    function placeGrid(rows, elems, up, head, left) {
      const body = rows.slice(1).filter(list => list.some(k => elems[k].kind === 'item'))
      const cols = Math.max(1, ...body.map(list => list.filter(k => elems[k].kind === 'item').length))
      const colW = new Array(cols).fill(0)
      const lanes = new Array(cols + 1).fill(0)
      const slotOf = new Map()
      for (const list of body) {
        let c = 0
        const here = new Array(cols + 1).fill(0)
        for (const k of list) {
          if (elems[k].kind === 'item') {
            colW[c] = Math.max(colW[c], elems[k].w)
            slotOf.set(k, c)
            c += 1
          } else {
            slotOf.set(k, c)
            here[c] += 1
          }
        }
        here.forEach((n, s) => (lanes[s] = Math.max(lanes[s], n)))
      }
      const slotW = lanes.map((n, s) => {
        const base = s === 0 || s === cols ? 0 : S.partGap

        return n > 0 ? Math.max(base, 2 * S.laneSide + (n - 1) * S.laneGap) : base
      })
      const slotX = []
      const colX = []
      let x = 0
      for (let s = 0; s <= cols; s += 1) {
        slotX.push(x)
        x += slotW[s]
        if (s < cols) {
          colX.push(x)
          x += colW[s]
        }
      }
      const gridW = x
      for (const list of body) {
        const inSlot = new Map()
        for (const k of list) if (elems[k].kind === 'ghost') push(inSlot, slotOf.get(k), k)
        for (const k of list) {
          if (elems[k].kind === 'item') left[k] = colX[slotOf.get(k)] + (colW[slotOf.get(k)] - elems[k].w) / 2
        }
        for (const [s, list2] of inSlot) list2.forEach((k, i) => (left[k] = slotX[s] + slotW[s] / 2 + (i - (list2.length - 1) / 2) * S.laneGap))
      }
      // la riga della scheda: le corsie che entrano le stanno ai lati
      left[head] = gridW / 2 - S.cardW / 2
      const top = rows[0]
      const at = top.indexOf(head)
      const below = k => {
        const xs = []
        for (const list of body) for (const j of list) for (const seg of up[j]) if (seg.a === k && !seg.isHidden) xs.push(left[j] + seg.offB)

        return xs.length > 0 ? xs.reduce((sum, v) => sum + v, 0) / xs.length : left[head] + S.cardW / 2
      }
      const before = top.slice(0, at)
      const after = top.slice(at + 1)
      const leftSide = spaced(before.map(below), S.laneGap)
      for (let i = leftSide.length - 1; i >= 0; i -= 1) leftSide[i] = Math.min(leftSide[i], i === leftSide.length - 1 ? left[head] - S.laneSide : leftSide[i + 1] - S.laneGap)
      before.forEach((k, i) => (left[k] = leftSide[i]))
      const rightSide = spaced(after.map(below), S.laneGap)
      for (let i = 0; i < rightSide.length; i += 1) rightSide[i] = Math.max(rightSide[i], i === 0 ? left[head] + S.cardW + S.laneSide : rightSide[i - 1] + S.laneGap)
      after.forEach((k, i) => (left[k] = rightSide[i]))
      // l'ultima riga: le uscite, sotto le parti da cui partono
      const foot = rows[rows.length - 1]
      if (!body.includes(foot) && foot !== top) {
        const aboveX = k => {
          const xs = up[k].filter(seg => !seg.isHidden).map(seg => left[seg.a] + seg.offA)

          return xs.length > 0 ? xs.reduce((sum, v) => sum + v, 0) / xs.length : gridW / 2
        }
        const xs = spaced(foot.map(aboveX), S.laneGap)
        foot.forEach((k, i) => (left[k] = xs[i]))
      }
    }

    // 4. tutto al suo posto: le sezioni dentro le sezioni, i blocchi soli in fondo
    const boxes = new Map()
    const frames = new Map()
    const origin = new Map()
    const put = (id, x, y) => {
      if (!open(id)) {
        boxes.set(id, { x, y, w: S.cardW, h: S.cardH, depth: depthOf(id), isOpen: false })

        return
      }
      const res = placed.get(id)
      origin.set(id, { x, y })
      frames.set(id, { x, y, w: res.w, h: res.h, depth: depthOf(id) })
      boxes.set(id, { x: x + res.head.x, y: y + res.head.y, w: S.cardW, h: S.cardH, depth: depthOf(id), isOpen: true })
      for (const [child, at] of res.pos) put(child, x + at.x, y + at.y)
    }
    const root = placed.get('')
    const alone = ranks.get('').alone
    const lines = []
    let line = []
    let lineW = 0
    const most = Math.max(root.w, 4 * S.cardW + 3 * S.colGap)
    for (const id of alone) {
      const size = sizeOf(id)
      if (line.length > 0 && lineW + S.colGap + size.w > most) {
        lines.push({ line, w: lineW })
        line = []
        lineW = 0
      }
      lineW += (line.length > 0 ? S.colGap : 0) + size.w
      line.push({ id, ...size })
    }
    if (line.length > 0) lines.push({ line, w: lineW })
    const width = Math.max(root.w, ...lines.map(one => one.w))
    const rootX = (width - root.w) / 2
    origin.set('', { x: rootX, y: 0 })
    for (const [id, at] of root.pos) put(id, rootX + at.x, at.y)
    let height = root.h
    let y = root.h > 0 ? root.h + S.isoGap : 0
    for (const one of lines) {
      let x = (width - one.w) / 2
      const tall = Math.max(...one.line.map(item => item.h))
      for (const item of one.line) {
        put(item.id, x, y)
        x += item.w + S.colGap
      }
      height = y + tall
      y += tall + S.rowGap * 0.6
    }

    // 5. ogni freccia: i suoi pezzi uno dopo l'altro, dall'alto in basso
    const routes = new Map()
    for (const one of routed) {
      const { edge, bundle } = one
      const parts = []
      for (const step of one.outs) for (const id of placed.get(step.section).outIds.get(`${bundle.key}|${step.el}`)) parts.push([step.section, id])
      parts.push([bundle.g, `m|${bundle.key}`])
      for (const step of one.ins) for (const id of placed.get(step.section).inIds.get(`${bundle.key}|${step.el}`)) parts.push([step.section, id])
      const points = []
      for (const [g, id] of parts) {
        const piece = placed.get(g).pieces.get(id)
        if (piece === undefined) continue
        const at = origin.get(g)
        for (const p of piece) {
          const q = { x: at.x + p.x, y: at.y + p.y }
          const prev = points[points.length - 1]
          if (prev !== undefined && Math.abs(prev.x - q.x) < 0.01 && Math.abs(prev.y - q.y) < 0.01) continue
          points.push(q)
        }
      }
      // via i punti in mezzo a un tratto dritto
      const clean = points.filter((p, i) => {
        if (i === 0 || i === points.length - 1) return true
        const a = points[i - 1]
        const b = points[i + 1]

        return !((Math.abs(a.x - p.x) < 0.01 && Math.abs(p.x - b.x) < 0.01) || (Math.abs(a.y - p.y) < 0.01 && Math.abs(p.y - b.y) < 0.01))
      })
      routes.set(edge.id, { top: one.top, bottom: one.bottom, points: clean, bundle: bundle.key })
    }

    return { boxes, frames, routes, width, height }
  }

  return { SIZE, buildModel, isAncestor, isOpen, repOf, visibleIds, liftEdges, commonParent, layout, isotonic }
})
