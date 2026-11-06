import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const L = require('../skills/map/assets/layout.js')

// Un albero da una forma compatta: { a: ['a1', 'a2'], b: [] } e archi [['a', 'b']].
function model(tree, links, soft = []) {
  const parentOf = new Map()
  for (const [id, kids] of Object.entries(tree)) for (const kid of kids) parentOf.set(kid, id)
  const ids = new Set([...Object.keys(tree), ...Object.values(tree).flat()])
  const nodes = [...ids].map(id => ({ id, parent: parentOf.get(id) ?? null, children: tree[id] ?? [] }))
  const roots = nodes.filter(node => node.parent === null).map(node => node.id)
  const edges = links.map(([a, b, w = 1]) => ({ a, b, w, soft: soft.includes(b), declared: false }))

  return L.buildModel({ nodes, roots, edges })
}

function run(m, open = []) {
  const expanded = new Set(open)
  const edges = L.liftEdges(m, expanded)

  return { edges, ...L.layout(m, expanded, edges) }
}

const overlap = (p, q) => p.x < q.x + q.w - 0.5 && q.x < p.x + p.w - 0.5 && p.y < q.y + q.h - 0.5 && q.y < p.y + p.h - 0.5
const contains = (outer, inner) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5

// Una freccia pulita: solo tratti in verticale o in orizzontale, che non entrano in nessuna
// scheda, dal fondo della scheda in alto alla cima di quella in basso.
function assertClean(name, route, boxes) {
  const pts = route.points
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [p, q] = [pts[i], pts[i + 1]]
    assert.ok(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01, `${name}: tratto storto`)
    const xs = [Math.min(p.x, q.x), Math.max(p.x, q.x)]
    const ys = [Math.min(p.y, q.y), Math.max(p.y, q.y)]
    for (const [id, box] of boxes) {
      const isIn = xs[1] > box.x + 0.5 && xs[0] < box.x + box.w - 0.5 && ys[1] > box.y + 0.5 && ys[0] < box.y + box.h - 0.5
      assert.ok(!isIn, `${name} passa dentro ${id}`)
    }
  }
  const top = boxes.get(route.top)
  const bottom = boxes.get(route.bottom)
  const [first, last] = [pts[0], pts[pts.length - 1]]
  assert.ok(Math.abs(first.y - (top.y + top.h)) < 0.5 && first.x >= top.x && first.x <= top.x + top.w, `${name}: non parte dal fondo di ${route.top}`)
  assert.ok(Math.abs(last.y - bottom.y) < 0.5 && last.x >= bottom.x && last.x <= bottom.x + bottom.w, `${name}: non arriva in cima a ${route.bottom}`)
}

test('una catena a → b → c scende di riga in riga', () => {
  const { boxes } = run(model({ a: [], b: [], c: [] }, [['a', 'b'], ['b', 'c']]))
  assert.ok(boxes.get('a').y < boxes.get('b').y)
  assert.ok(boxes.get('b').y < boxes.get('c').y)
  assert.equal(boxes.get('a').x, boxes.get('b').x)
})

test('chi non è usato da nessuno scende fino a stare sopra chi usa', () => {
  // a → b → c → d, e → d: e sta nella riga di c, non in quella di a
  const { boxes } = run(model({ a: [], b: [], c: [], d: [], e: [] }, [['a', 'b'], ['b', 'c'], ['c', 'd'], ['e', 'd']]))
  assert.equal(boxes.get('e').y, boxes.get('c').y)
})

test('i cicli non rompono niente', () => {
  const { boxes, routes } = run(model({ a: [], b: [], c: [] }, [['a', 'b'], ['b', 'c'], ['c', 'a']]))
  for (const box of boxes.values()) assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y))
  assert.equal(new Set([...boxes.values()].map(box => box.y)).size, 3)
  for (const [id, route] of routes) assertClean(id, route, boxes)
})

test('i blocchi senza collegamenti vanno in fondo, i collegamenti verso le utilità non contano', () => {
  const m = model({ a: [], b: [], util: [], x: [] }, [['a', 'b'], ['a', 'util'], ['b', 'util']], ['util'])
  const { boxes } = run(m)
  const bottom = Math.max(boxes.get('a').y, boxes.get('b').y) + L.SIZE.cardH
  assert.ok(boxes.get('util').y >= bottom)
  assert.ok(boxes.get('x').y >= bottom)
})

test('un blocco aperto resta una scheda e sotto di lei si apre la sua sezione, con le parti dentro', () => {
  const m = model({ ui: [], api: ['routes', 'auth', 'db'], store: [] }, [['ui', 'routes'], ['routes', 'db'], ['db', 'store']])
  const closed = run(m)
  assert.deepEqual(closed.edges.map(edge => edge.id).sort(), ['api>store', 'ui>api'])
  assert.equal(closed.boxes.size, 3)
  assert.equal(closed.frames.size, 0)

  const open = run(m, ['api'])
  assert.deepEqual(open.edges.map(edge => edge.id).sort(), ['db>store', 'routes>db', 'ui>routes'])
  assert.equal(open.boxes.size, 6)
  const api = open.boxes.get('api')
  const frame = open.frames.get('api')
  assert.ok(frame, 'la sezione di api')
  assert.ok(contains(frame, api) && Math.abs(api.y - frame.y - L.SIZE.padTop) < 1, 'la scheda del blocco sta in cima alla sua sezione')
  for (const part of ['routes', 'auth', 'db']) {
    const box = open.boxes.get(part)
    assert.ok(box.y > api.y + api.h, `${part} sta sotto il suo blocco`)
    assert.ok(contains(frame, box), `${part} sta dentro la sezione`)
  }
  for (const id of ['ui', 'store']) assert.ok(!overlap(frame, open.boxes.get(id)), `${id} sta fuori dalla sezione`)
  const list = [...open.boxes.values()]
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) assert.ok(!overlap(list[i], list[j]))
  // la freccia entra nella sezione e arriva alla parte giusta
  const into = open.routes.get('ui>routes')
  assert.equal(into.top, 'ui')
  assert.equal(into.bottom, 'routes')
  for (const [id, route] of open.routes) assertClean(id, route, open.boxes)
})

test('le parti di una sezione vanno a capo in righe simili', () => {
  const kids = Array.from({ length: 10 }, (_, i) => `p${i}`)
  const m = model({ big: kids, other: [] }, [['big', 'other']])
  const { boxes } = run(m, ['big'])
  const rows = new Map()
  for (const id of kids) rows.set(boxes.get(id).y, (rows.get(boxes.get(id).y) || 0) + 1)
  assert.deepEqual([...rows.values()], [5, 5])
})

test('la scheda di una sezione sta sopra il centro delle sue parti', () => {
  const m = model({ a: [], group: ['g1', 'g2', 'g3'], b: [], c: [] }, [['a', 'b'], ['a', 'c'], ['g1', 'b'], ['g3', 'c']])
  const { boxes } = run(m, ['group'])
  const group = boxes.get('group')
  const parts = ['g1', 'g2', 'g3'].map(id => boxes.get(id))
  const centre = group.x + group.w / 2
  const mid = (Math.min(...parts.map(box => box.x)) + Math.max(...parts.map(box => box.x + box.w))) / 2
  assert.ok(Math.abs(centre - mid) < L.SIZE.cardW / 2)
})

test('le frecce lunghe girano solo ad angolo retto e non passano dentro i blocchi', () => {
  const m = model({ a: [], b: [], c: [], d: [], x: [], y: [] }, [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'd'], ['x', 'b'], ['y', 'c']])
  m.edges.find(edge => edge.a === 'a' && edge.b === 'd').label = 'usa'
  const { boxes, routes } = run(m)
  assert.ok(routes.has('a>d'))
  for (const [id, route] of routes) assertClean(id, route, boxes)
})

test('collegamenti interni a un blocco chiuso spariscono, i doppi si sommano, le frecce opposte si fondono', () => {
  const m = model({ a: ['a1', 'a2'], b: ['b1', 'b2'] }, [['a1', 'a2'], ['a1', 'b1', 3], ['a2', 'b1', 2], ['b2', 'a1', 1]])
  const edges = L.liftEdges(m, new Set())
  assert.equal(edges.length, 1)
  assert.equal(edges[0].id, 'a>b')
  assert.equal(edges[0].w, 6)
  assert.equal(edges[0].bidir, true)
  assert.equal(edges[0].count, 3)
})

test('si vedono subito i collegamenti con un nome e quelli forti; i deboli e quelli verso le utilità solo passandoci sopra', () => {
  const m = model({ a: [], b: [], c: [], util: [] }, [['a', 'b', 100], ['a', 'c', 2], ['b', 'c', 100], ['a', 'util', 50]], ['util'])
  m.edges.push({ a: 'c', b: 'util', w: 1, soft: true, declared: false, label: 'legge' })
  const minor = Object.fromEntries(L.liftEdges(m, new Set()).map(edge => [edge.id, edge.minor]))
  assert.deepEqual(minor, { 'a>b': false, 'a>c': true, 'b>c': false, 'a>util': true, 'c>util': false })
})

test('un collegamento nominato resta in vista anche aprendo i blocchi, con la sua freccia più forte e senza nome', () => {
  const m = model({ pages: ['p1', 'p2', 'p3'], api: [], ui: [] }, [['p1', 'ui', 50], ['p2', 'ui', 50], ['p3', 'ui', 50], ['p1', 'api', 1], ['p2', 'api', 1], ['ui', 'api', 30]])
  for (const edge of m.edges) if (edge.b === 'api' && edge.a !== 'ui') Object.assign(edge, { label: 'chiede', lf: 'pages', lt: 'api' })
  const closed = L.liftEdges(m, new Set()).find(edge => edge.id === 'pages>api')
  assert.equal(closed.named, true)
  m.edges.find(edge => edge.a === 'p1' && edge.b === 'api').w = 3
  const open = L.liftEdges(m, new Set(['pages'])).filter(edge => edge.b === 'api' && edge.a.startsWith('p'))
  assert.equal(open.length, 2)
  // ne resta in vista solo la più forte, senza nome
  const shown = open.filter(edge => !edge.minor)
  assert.deepEqual(shown.map(edge => edge.id), ['p1>api'])
  assert.equal(shown[0].named, false)
})

test('in nessun grafo casuale i blocchi si sovrappongono, le sezioni escono dal loro posto o le frecce passano dentro un blocco', () => {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff

    return seed / 0x7fffffff
  }
  for (let round = 0; round < 80; round += 1) {
    const tree = {}
    const top = 2 + Math.floor(rnd() * 9)
    const all = []
    for (let i = 0; i < top; i += 1) {
      const kids = rnd() < 0.5 ? Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, k) => `n${i}_${k}`) : []
      tree[`n${i}`] = kids
      all.push(`n${i}`, ...kids)
      for (const kid of kids) {
        if (rnd() < 0.25) {
          const grand = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => `${kid}_${k}`)
          tree[kid] = grand
          all.push(...grand)
        }
      }
    }
    const links = []
    for (let e = 0; e < all.length * 1.4; e += 1) {
      const a = all[Math.floor(rnd() * all.length)]
      const b = all[Math.floor(rnd() * all.length)]
      if (a !== b) links.push([a, b, 1 + Math.floor(rnd() * 5)])
    }
    const m = model(tree, links)
    const groups = Object.keys(tree).filter(id => tree[id].length > 0)
    const open = groups.filter(id => rnd() < 0.6 && m.chain.get(id).slice(1).every(up => groups.includes(up)))
    const expanded = new Set(open)
    for (const id of [...expanded]) if (m.chain.get(id).slice(1).some(up => !expanded.has(up))) expanded.delete(id)
    const { boxes, frames, routes, width, height } = run(m, [...expanded])
    assert.equal(boxes.size, L.visibleIds(m, expanded).length)
    const list = [...boxes.entries()]
    for (const [id, box] of list) {
      assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y) && box.x >= -0.5 && box.y >= -0.5, `${id} fuori posto`)
      assert.ok(box.x + box.w <= width + 0.5 && box.y + box.h <= height + 0.5, `${id} fuori dal disegno`)
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) assert.ok(!overlap(list[i][1], list[j][1]), `${list[i][0]} e ${list[j][0]} si sovrappongono (giro ${round})`)
    }
    for (const [id, route] of routes) assertClean(`${id} (giro ${round})`, route, boxes)
    // ogni parte sta nella sezione del suo blocco; il resto ne sta fuori
    for (const [id, frame] of frames) {
      for (const [other, box] of boxes) {
        const isMine = other === id || L.isAncestor(m, id, other)
        if (isMine) assert.ok(contains(frame, box), `${other} fuori dalla sezione di ${id} (giro ${round})`)
        else if (!L.isAncestor(m, other, id)) assert.ok(!overlap(frame, box), `${other} dentro la sezione di ${id} (giro ${round})`)
      }
      for (const [other, box] of frames) {
        if (other === id || L.isAncestor(m, id, other) || L.isAncestor(m, other, id)) continue
        assert.ok(!overlap(frame, box), `sezioni ${id} e ${other} sovrapposte (giro ${round})`)
      }
    }
  }
})

test('isotonic dà la sequenza non decrescente più vicina', () => {
  assert.deepEqual(L.isotonic([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(L.isotonic([3, 1]), [2, 2])
  assert.deepEqual(L.isotonic([1, 5, 2, 8]), [1, 3.5, 3.5, 8])
})
