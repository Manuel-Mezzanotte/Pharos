import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { applyNames, assemble, buildData, compilePattern } from '../skills/map/scripts/render.mjs'
import { scanProject } from '../skills/map/scripts/scan.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'pharos-render-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

const edgeOf = (data, a, b) => data.edges.find(edge => edge.a === a && edge.b === b)

test('compilePattern: file esatto, cartella e glob, con le loro precedenze', () => {
  const folder = compilePattern('src/api/')
  const exact = compilePattern('src/api/index.ts')
  const anywhere = compilePattern('*.test.ts')
  const fromRoot = compilePattern('src/**/*.ts')
  assert.equal(folder('src/api/users.ts').tier, 1)
  assert.equal(folder('src/apix/users.ts'), undefined)
  assert.equal(exact('src/api/index.ts').tier, 3)
  assert.equal(anywhere('a/b/c.test.ts').tier, 2)
  assert.equal(anywhere('c.test.js'), undefined)
  assert.equal(fromRoot('src/a/b/c.ts').tier, 2)
  assert.equal(fromRoot('lib/c.ts'), undefined)
  assert.equal(compilePattern('**/__tests__/')('a/__tests__/x.ts').tier, 2)
})

test('ogni file va al blocco con il percorso più preciso, i collegamenti nascono dagli import', () => {
  const root = project({
    'web/app.ts': "import { api } from '../server/routes/users'\nimport { pay } from 'stripe'\nexport const a = 1\n",
    'server/routes/users.ts': "import { rule } from '../domain/rule'\nexport const api = 1\n",
    'server/routes/users.test.ts': "import { api } from './users'\n",
    'server/domain/rule.ts': "import Stripe from 'stripe'\nexport const rule = 1\n",
  })
  try {
    const { data, errors, warnings } = buildData(
      {
        nodes: [
          { name: 'Web', kind: 'interface', summary: 'Pages.', paths: ['web/'] },
          { name: 'API', kind: 'api', summary: 'Routes.', paths: ['server/routes/'] },
          { name: 'Rules', kind: 'logic', summary: 'Rules.', paths: ['server/domain/'] },
          { name: 'Tests', kind: 'test', summary: 'Checks.', paths: ['**/*.test.ts'] },
          { name: 'Stripe', kind: 'external', summary: 'Payments.', packages: ['stripe'] },
        ],
        links: [{ from: 'web', to: 'api', label: 'asks' }],
      },
      scanProject(root),
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings, [])
    const by = id => data.nodes.find(node => node.id === id)
    assert.equal(by('api').files, 1)
    assert.equal(by('tests').files, 1)
    // l'import nel codice, col nome dato da Claude
    assert.equal(edgeOf(data, 'web', 'api').w, 1)
    assert.equal(edgeOf(data, 'web', 'api').label, 'asks')
    assert.equal(edgeOf(data, 'web', 'api').declared, false)
    // le dipendenze esterne arrivano dai pacchetti dichiarati
    assert.equal(edgeOf(data, 'web', 'stripe').w, 1)
    assert.equal(edgeOf(data, 'rules', 'stripe').w, 1)
    assert.equal(by('stripe').usedBy, 2)
    assert.deepEqual(by('stripe').packages, ['stripe'])
    // i test che importano il codice sono collegamenti "leggeri"
    assert.equal(edgeOf(data, 'tests', 'api').soft, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('un collegamento scritto a mano senza import resta da solo; uno tra blocchi che si importano dà il nome', () => {
  const root = project({ 'a/x.ts': "import { y } from '../b/y'\n", 'b/y.ts': 'export const y = 1\n', 'c/z.ts': 'export const z = 1\n' })
  try {
    const { data } = buildData(
      {
        nodes: [
          { id: 'a', name: 'A', kind: 'interface', summary: 's', paths: ['a/'] },
          { id: 'b', name: 'B', kind: 'logic', summary: 's', paths: ['b/'] },
          { id: 'c', name: 'C', kind: 'external', summary: 's', paths: ['c/'] },
        ],
        links: [
          { from: 'a', to: 'b', label: 'uses' },
          { from: 'b', to: 'c', label: 'calls over HTTP' },
        ],
      },
      scanProject(root),
    )
    assert.equal(edgeOf(data, 'a', 'b').label, 'uses')
    assert.equal(edgeOf(data, 'a', 'b').declared, false)
    assert.deepEqual(edgeOf(data, 'b', 'c'), { a: 'b', b: 'c', w: 1, label: 'calls over HTTP', lf: 'b', lt: 'c', declared: true, soft: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('un collegamento tra blocchi aperti dà il nome agli import dei loro figli, il più preciso vince', () => {
  const root = project({ 'ui/a.ts': "import '../api/x'\nimport '../api/y'\n", 'api/x.ts': '', 'api/y.ts': '' })
  try {
    const { data } = buildData(
      {
        nodes: [
          { id: 'ui', name: 'UI', kind: 'interface', summary: 's', children: [{ id: 'a', name: 'A', kind: 'interface', summary: 's', paths: ['ui/'] }] },
          {
            id: 'api',
            name: 'API',
            kind: 'api',
            summary: 's',
            children: [
              { id: 'x', name: 'X', kind: 'api', summary: 's', paths: ['api/x.ts'] },
              { id: 'y', name: 'Y', kind: 'api', summary: 's', paths: ['api/y.ts'] },
            ],
          },
        ],
        links: [
          { from: 'ui', to: 'api', label: 'calls' },
          { from: 'a', to: 'x', label: 'reads' },
        ],
      },
      scanProject(root),
    )
    assert.equal(edgeOf(data, 'a', 'x').label, 'reads')
    assert.equal(edgeOf(data, 'a', 'y').label, 'calls')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('gli errori e gli avvisi dicono cosa sistemare', () => {
  const root = project({ 'src/a.ts': 'export const a = 1\n', 'other/b.ts': 'export const b = 1\n', 'other/c.ts': 'export const c = 1\n' })
  try {
    const scan = scanProject(root)
    assert.match(buildData({ nodes: [] }, scan).errors[0], /non-empty "nodes"/)
    assert.match(buildData({ nodes: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }, scan).errors[0], /share the id "a"/)
    assert.match(buildData({ nodes: [{ id: 'a' }] }, scan).errors[0], /no "name"/)

    const { data, warnings, notes } = buildData(
      {
        nodes: [
          { id: 'src', name: 'Source', kind: 'logic', paths: ['src/'] },
          { id: 'ghost', name: 'Ghost', kind: 'banana', summary: 'x', paths: ['nowhere/'] },
          { id: 'rest', name: 'Altre pagine', kind: 'interface', summary: 'x', paths: ['other/'] },
        ],
        links: [{ from: 'src', to: 'nobody' }],
      },
      scan,
    )
    assert.ok(data !== undefined)
    assert.ok(warnings.some(text => /unknown kind "banana"/.test(text)))
    assert.ok(warnings.some(text => /"ghost" matched no files/.test(text)))
    assert.ok(warnings.some(text => /Block "src" has no "summary"/.test(text)))
    assert.ok(warnings.some(text => /unknown block id/.test(text)))
    assert.ok(warnings.some(text => /"rest" \("Altre pagine"\) is a catch-all/.test(text)))
    assert.ok(warnings.some(text => /Path "nowhere\/" of block "ghost" matches no file/.test(text)))
    assert.ok(notes.length > 0)
    const loose = buildData({ nodes: [{ id: 'src', name: 'Source', kind: 'logic', summary: 'x', paths: ['src/'] }] }, scan)
    assert.ok(loose.warnings.some(text => /2 of 3 files \(67%\) are in no block.*other\/ \(2\)/.test(text)))
    for (const name of ['Altro del progetto', 'Other services', 'Misc', 'Varie']) {
      assert.ok(buildData({ nodes: [{ id: 'x', name, kind: 'logic', summary: 'x', paths: ['src/', 'other/'] }] }, scan).warnings.some(text => /catch-all/.test(text)), name)
    }
    for (const name of ['Alternative', 'Variabili', 'Restyling', 'Pagine']) {
      assert.ok(!buildData({ nodes: [{ id: 'x', name, kind: 'logic', summary: 'x', paths: ['src/', 'other/'] }] }, scan).warnings.some(text => /catch-all/.test(text)), name)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('l’esempio di SKILL.md è un names.json valido sopra una bozza', () => {
  const skill = readFileSync(join(here, '..', 'skills', 'map', 'SKILL.md'), 'utf8')
  const names = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(skill)[1])
  const root = project({
    'app/orders/page.tsx': "fetch('/api/orders')\n",
    'app/page.tsx': '',
    'app/api/orders/route.ts': "import { send } from '../../../lib/services/invoice'\n",
    'lib/services/invoice.ts': "import Stripe from 'stripe'\nfetch('https://api.supplier.example/stock')\n",
    'lib/services/receipt.ts': '',
    'lib/services/cart.ts': '',
  })
  const draft = {
    generator: 'pharos-draft/1',
    nodes: [
      { id: 'pages', name: 'Pages', kind: 'interface', summary: '2 files', auto: true, children: [
        { id: 'pages-orders', name: 'Orders', kind: 'interface', summary: '1 file', auto: true, paths: ['app/orders/'] },
        { id: 'pages-home', name: 'Home', kind: 'interface', summary: '1 file', auto: true, paths: ['app/page.tsx'] },
      ] },
      { id: 'api', name: 'API', kind: 'api', summary: '1 file', auto: true, paths: ['app/api/'] },
      { id: 'logic', name: 'Logic', kind: 'logic', summary: '3 files', auto: true, children: [
        { id: 'logic-invoice', name: 'Invoice', kind: 'logic', summary: '1 file', auto: true, paths: ['lib/services/invoice.ts'] },
        { id: 'logic-cart', name: 'Cart', kind: 'logic', summary: '2 files', auto: true, paths: ['lib/services/'] },
      ] },
      { id: 'stripe', name: 'Stripe', kind: 'external', summary: 'used by 1 file', auto: true, packages: ['stripe'] },
    ],
    links: [],
  }
  try {
    const scan = scanProject(root)
    const { spec, warnings: early } = applyNames(draft, names, scan)
    assert.deepEqual(early, [])
    const { data, errors, warnings } = buildData(spec, scan)
    assert.deepEqual(errors, [])
    assert.ok(warnings.every(warning => warning.includes("draft's automatic names")), warnings.join('\n'))
    assert.equal(data.title, 'Shop')
    assert.equal(data.nodes.find(node => node.id === 'pages').name, 'Storefront')
    assert.equal(data.files.find(file => file.p === 'lib/services/receipt.ts').n, 'logic-invoice')
    assert.equal(edgeOf(data, 'logic-invoice', 'stripe').label, 'charges with')
    assert.equal(edgeOf(data, 'pages-orders', 'api').label, 'asks for data')
    // un servizio aggiunto a mano, con la sua freccia
    assert.equal(data.nodes.find(node => node.id === 'supplier-api').kind, 'external')
    assert.equal(edgeOf(data, 'logic-invoice', 'supplier-api').label, 'checks stock')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('la pagina è un solo file e i dati non possono chiudere lo script', () => {
  const html = assemble({
    title: 'A <b> "quote" & co',
    lang: 'it',
    summary: '</script><script>alert(1)</script>',
    generated: '2026-11-04T10:00:00Z',
    roots: ['a'],
    nodes: [{ id: 'a', name: 'A', kind: 'other', summary: '', about: '', parent: null, children: [], external: false, files: 0, loc: 0, top: [], packages: [], usedBy: 0 }],
    edges: [],
  })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<title>A &lt;b&gt; &quot;quote&quot; &amp; co · Pharos<\/title>/)
  assert.equal(html.includes('</script><script>alert(1)'), false)
  assert.equal((html.match(/<script>/g) ?? []).length, 4)
  assert.equal(html.includes('/*__'), false)
  assert.equal(html.includes('__TITLE__'), false)
})

test('la pagina riceve tutti i file dei blocchi, con chi importano', () => {
  const root = project({ 'a/x.ts': "import { y } from '../b/y'\nexport const x = 1\n", 'b/y.ts': '// Il cuore dei calcoli.\nexport function y() {}\n' })
  try {
    const { data } = buildData(
      {
        nodes: [
          { id: 'a', name: 'A', kind: 'interface', summary: 's', paths: ['a/'] },
          { id: 'b', name: 'B', kind: 'logic', summary: 's', paths: ['b/'] },
        ],
        links: [{ from: 'a', to: 'b', label: 'calcola con' }],
      },
      scanProject(root),
    )
    assert.equal(data.files.length, 2)
    const x = data.files.findIndex(file => file.p === 'a/x.ts')
    const y = data.files.findIndex(file => file.p === 'b/y.ts')
    assert.deepEqual(data.files[x].im, [y])
    assert.deepEqual(data.files[y].ex, ['y'])
    assert.equal(data.files[y].d, 'Il cuore dei calcoli.')
    assert.equal(data.files[y].by, 1)
    assert.deepEqual(data.nodes.find(node => node.id === 'b').own, [y])
    assert.deepEqual(edgeOf(data, 'a', 'b'), { a: 'a', b: 'b', w: 1, label: 'calcola con', lf: 'a', lt: 'b', declared: false, soft: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
