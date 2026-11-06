import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { spawnSync } from 'node:child_process'
import { utimesSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { draftMap, fingerprintOf, mapStatus, roleOf, stem, topicWords } from '../skills/map/scripts/draft.mjs'
import { applyNames, buildData } from '../skills/map/scripts/render.mjs'
import { apiRoutes, apiUrls, matchRoute, scanProject } from '../skills/map/scripts/scan.mjs'

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'pharos-draft-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

// Un negozio fatto con Next.js: pagine e API nelle rotte, servizi in una cartella piatta e grande.
function shop() {
  const files = {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { next: '15.0.0', react: '19.0.0', mongoose: '8.0.0', stripe: '17.0.0' } }),
    'app/layout.tsx': "import '../components/ui/button'\nexport default function Layout() {}\n",
    'app/page.tsx': "import { Button } from '../components/ui/button'\nexport default function Home() {}\n",
    'app/globals.css': 'body { margin: 0 }\n',
    'app/login/page.tsx': "import { LoginForm } from '../../components/login-form'\nexport default function Login() {}\n",
    'app/api/orders/route.ts': "import { listOrders } from '../../../lib/services/order-list'\nexport async function GET() {}\n",
    'app/api/orders/[id]/route.ts': "import { getOrder } from '../../../../lib/services/order-get'\nexport async function GET() {}\n",
    'app/api/customers/route.ts': "import { listCustomers } from '../../../lib/services/customer-list'\nexport async function GET() {}\n",
    'app/api/invoices/route.ts': "import { listInvoices } from '../../../lib/services/invoice-list'\nexport async function GET() {}\n",
    'components/ui/button.tsx': 'export function Button() {}\n',
    'components/ui/input.tsx': 'export function Input() {}\n',
    'components/ui/dialog.tsx': 'export function Dialog() {}\n',
    'components/login-form.tsx': "import { Input } from './ui/input'\nexport function LoginForm() {}\n",
    'components/order-card.tsx': "import { Button } from './ui/button'\nexport function OrderCard() {}\n",
    'components/order-table.tsx': "import { Button } from './ui/button'\nexport function OrderTable() {}\n",
    'lib/models/order.model.ts': "import mongoose from 'mongoose'\nexport const Order = 1\n",
    'lib/models/customer.model.ts': "import mongoose from 'mongoose'\nexport const Customer = 1\n",
    'lib/models/invoice.model.ts': "import mongoose from 'mongoose'\nexport const Invoice = 1\n",
    'lib/db.ts': "import mongoose from 'mongoose'\nexport const db = 1\n",
    'lib/utils.ts': 'export const cn = 1\n',
    'lib/format-date.ts': 'export const formatDate = 1\n',
    'lib/format-money.ts': 'export const formatMoney = 1\n',
    'tests/orders.test.ts': "import { listOrders } from '../lib/services/order-list'\n",
    'tests/customers.test.ts': "import { listCustomers } from '../lib/services/customer-list'\n",
    'tests/invoices.test.ts': "import { listInvoices } from '../lib/services/invoice-list'\n",
    'scripts/seed.ts': "import { db } from '../lib/db'\n",
    'next.config.ts': 'export default {}\n',
  }
  // tre sezioni di pagine, ognuna con le sue sotto-pagine e le sue chiamate all'API
  for (const [section, n] of [['orders', 16], ['customers', 14], ['settings', 12]]) {
    for (let i = 0; i < n; i += 1) {
      const dir = i % 2 === 0 ? `app/${section}` : `app/${section}/[id]`
      const call = section === 'settings' ? '' : i % 2 === 0 ? `fetch('/api/${section}')\n` : `fetch(\`/api/${section}/\${id}\`)\n`
      files[`${dir}/${section}-view-${i}.tsx`] = `import { Button } from '${'../'.repeat(dir.split('/').length)}components/ui/button'\n${call}export function V${i}() {}\n`
    }
  }
  // una cartella di servizi piatta e grande: tre argomenti nei nomi dei file
  const topics = { order: 16, customer: 14, invoice: 14 }
  for (const [topic, n] of Object.entries(topics)) {
    for (let i = 0; i < n; i += 1) {
      const name = i === 0 ? `${topic}-list` : i === 1 ? `${topic}-get` : `${topic}-step-${i}`
      const peer = i > 1 ? `import { x } from './${topic}-list'\n` : ''
      files[`lib/services/${name}.ts`] = `import { ${topic} } from '../models/${topic}.model'\n${peer}export const ${topic}${i} = 1\n`
    }
  }
  files['lib/services/invoice-step-2.ts'] += "import Stripe from 'stripe'\n"
  // servizi raggiunti con un indirizzo: un'AI nota, un altro servizio del prodotto, un portale sconosciuto
  files['lib/services/invoice-step-3.ts'] += "fetch('https://api.openai.com/v1/responses')\nconst ws = process.env.BILLING_SERVICE_URL\nconst me = process.env.NEXT_PUBLIC_APP_URL\n"
  files['lib/services/customer-step-3.ts'] += "fetch('https://portal.tax.example.gov/api')\n"

  return project(files)
}

const flat = nodes => nodes.flatMap(node => [node, ...flat(node.children ?? [])])
const depthOf = (nodes, depth = 1) => Math.max(0, ...nodes.map(node => (node.children ? depthOf(node.children, depth + 1) : depth)))

test('parole e strati: il nome dice l’argomento, cartelle e nomi dicono lo strato', () => {
  assert.deepEqual(topicWords('lib/services/expense-line.service.ts'), ['expense', 'line'])
  assert.deepEqual(topicWords('components/ExpenseLineDialog.tsx'), ['expense', 'line'])
  assert.equal(stem('activities'), 'activity')
  assert.equal(stem('status'), 'status')
  const role = (path, extra = {}) => roleOf({ path, ext: path.slice(path.lastIndexOf('.')), language: 'TypeScript', externals: [], ...extra }, new Map()).block
  assert.equal(role('src/services/user.ts'), 'logic')
  assert.equal(role('src/models/user.ts'), 'data')
  assert.equal(role('src/services/user.model.ts'), 'data')
  assert.equal(role('src/services/user.test.ts'), 'tests')
  assert.equal(role('src/components/user-card.tsx'), 'ui')
  assert.equal(role('src/routes/users.ts'), 'api')
  assert.equal(role('src/utils/date.ts'), 'shared')
  assert.equal(role('.github/workflows/test/ci.ts'), 'tooling')
  // "schemas/" è il database solo se usa il database
  assert.equal(role('lib/validation/schemas/user.ts'), 'logic')
  assert.equal(role('lib/db/schemas/user.ts', { externals: ['mongoose'] }), 'data')
  assert.equal(role('app/models.py', { ext: '.py', language: 'Python' }), 'data')
  assert.equal(role('app/views.py', { ext: '.py', language: 'Python' }), 'api')
  // un lavoro in background è prodotto anche dentro scripts/; un .md non è mai un test
  assert.equal(role('scripts/compliance-worker.ts', { imports: ['lib/kafka/client.ts'] }), 'logic')
  assert.equal(role('scripts/copy-pdf-worker.js', { ext: '.js', language: 'JavaScript' }), 'tooling')
  assert.equal(role('scripts/seed.ts'), 'tooling')
  assert.equal(role('docs/specs/design.md', { ext: '.md', language: 'Markdown' }), 'docs')
})

test('le chiamate /api/... trovano il file che risponde', () => {
  const routes = apiRoutes(['app/api/orders/route.ts', 'app/api/orders/[id]/route.ts', 'app/api/orders/export/route.ts', 'pages/api/legacy/[...all].ts'])
  assert.deepEqual(apiUrls('fetch(`/api/orders/${id}?x=1`); fetch("/api/orders")'), ['/api/orders/*', '/api/orders'])
  assert.equal(matchRoute('/api/orders', routes), 'app/api/orders/route.ts')
  assert.equal(matchRoute('/api/orders/*', routes), 'app/api/orders/[id]/route.ts')
  assert.equal(matchRoute('/api/orders/export', routes), 'app/api/orders/export/route.ts')
  assert.equal(matchRoute('/api/orders/42', routes), 'app/api/orders/[id]/route.ts')
  assert.equal(matchRoute('/api/legacy/a/b', routes), 'pages/api/legacy/[...all].ts')
  assert.equal(matchRoute('/api/unknown', routes), undefined)
})

test('la bozza di un progetto Next.js: strati in alto, rotte e argomenti dentro, ogni file al suo posto', () => {
  const root = shop()
  try {
    const scan = scanProject(root)
    const calls = scan.files.find(file => file.path === 'app/orders/[id]/orders-view-1.tsx').calls
    assert.deepEqual(calls, ['app/api/orders/[id]/route.ts'])

    const map = draftMap(scan, { lang: 'en', coChange: new Map() })
    const tops = map.nodes.map(node => node.id)
    for (const id of ['pages', 'api', 'ui', 'logic', 'data', 'shared', 'tests', 'tooling', 'mongodb', 'stripe']) assert.ok(tops.includes(id), `missing ${id} in ${tops}`)
    const all = flat(map.nodes)
    assert.equal(new Set(all.map(node => node.id)).size, all.length, 'ids are unique')
    assert.ok(depthOf(map.nodes) <= 3)
    for (const node of all) assert.ok((node.children?.length ?? 0) <= 10, `${node.id} has too many parts`)

    // le pagine seguono le rotte, senza i parametri: [id] sta con la sua sezione
    const pages = map.nodes.find(node => node.id === 'pages')
    const sections = pages.children.map(node => node.name)
    for (const name of ['Orders', 'Customers', 'Settings']) assert.ok(sections.includes(name), `pages: ${sections}`)
    // la cartella piatta dei servizi si divide per argomento, e le sue parti salgono nel blocco
    const logic = map.nodes.find(node => node.id === 'logic')
    assert.deepEqual(logic.children.map(node => stem(node.name.toLowerCase())).sort(), ['customer', 'invoice', 'order'])

    // render legge la bozza così com'è: tutti i file trovano il blocco giusto
    const { data, warnings, stats } = buildData(map, scan)
    assert.equal(stats.assigned, stats.files)
    assert.ok(!warnings.some(warning => /catch-all|matches no file|matched no files/.test(warning)), warnings.join('\n'))
    const owner = path => data.nodes.find(node => node.id === data.files.find(file => file.p === path).n)
    assert.equal(stem(owner('lib/services/invoice-step-7.ts').name.toLowerCase()), 'invoice')
    assert.equal(owner('app/orders/[id]/orders-view-3.tsx').name, 'Orders')
    assert.equal(owner('lib/models/order.model.ts').kind, 'data')
    // le pagine che chiamano l'API hanno la loro freccia, anche senza import
    assert.ok(data.edges.some(edge => edge.a === owner('app/orders/orders-view-0.tsx').id && edge.b === 'api'), 'pages → api from fetch')

    // i servizi raggiunti con un indirizzo hanno il loro blocco e le loro frecce; gli altri indirizzi restano da decidere
    assert.deepEqual(map.nodes.find(node => node.id === 'openai').reach, ['api.openai.com'])
    assert.deepEqual(map.nodes.find(node => node.id === 'billing-service').reach, ['BILLING_SERVICE_URL'])
    assert.ok(data.edges.some(edge => edge.b === 'openai' && edge.a === owner('lib/services/invoice-step-3.ts').id))
    assert.deepEqual(map.addresses.map(one => one.address), ['portal.tax.example.gov'])

        // stesso progetto, stessa bozza
    assert.equal(JSON.stringify(draftMap(scan, { lang: 'en', coChange: new Map() })), JSON.stringify(map))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('la bozza di un progetto Python: modelli, viste, servizi e test', () => {
  const root = project({
    'shop/models.py': 'import sqlalchemy\nclass Order: pass\n',
    'shop/views.py': 'from shop.models import Order\nfrom shop.services.billing import charge\n',
    'shop/urls.py': 'from shop import views\n',
    'shop/serializers.py': 'from shop.models import Order\n',
    'shop/services/billing.py': 'import stripe\nfrom shop.models import Order\ndef charge(): pass\n',
    'shop/services/shipping.py': 'from shop.models import Order\ndef ship(): pass\n',
    'shop/services/refunds.py': 'from shop.services.billing import charge\n',
    'tests/test_views.py': 'from shop import views\n',
    'tests/test_billing.py': 'from shop.services import billing\n',
    'tests/test_shipping.py': 'from shop.services import shipping\n',
  })
  try {
    const scan = scanProject(root)
    const map = draftMap(scan, { lang: 'it', coChange: new Map() })
    const byId = new Map(flat(map.nodes).map(node => [node.id, node]))
    assert.equal(byId.get('api').name, 'API')
    assert.equal(byId.get('logic').name, 'Logica')
    assert.ok(byId.has('tests') && byId.has('stripe'))
    const { stats } = buildData(map, scan)
    assert.equal(stats.assigned, stats.files)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('i nomi di Claude si sovrappongono alla bozza; i file si possono spostare', () => {
  const root = shop()
  try {
    const scan = scanProject(root)
    const map = draftMap(scan, { lang: 'en', coChange: new Map() })
    const logic = map.nodes.find(node => node.id === 'logic')
    const invoice = logic.children.find(node => stem(node.name.toLowerCase()) === 'invoice')
    const { spec, warnings } = applyNames(
      map,
      {
        title: 'Shop',
        lang: 'it',
        nodes: { logic: { name: 'Regole', summary: 'Prezzi, ordini e fatture.' }, [invoice.id]: 'Fatture', nope: 'X' },
        links: [{ from: 'pages', to: 'api', label: 'chiede' }],
        moves: { 'lib/services/order-step-5.ts': invoice.id },
      },
      scan,
    )
    assert.equal(spec.title, 'Shop')
    assert.ok(warnings.some(warning => warning.includes('"nope"')))
    const named = spec.nodes.find(node => node.id === 'logic')
    assert.equal(named.name, 'Regole')
    assert.equal(named.auto, undefined)
    const { data, warnings: late } = buildData(spec, scan)
    assert.equal(data.files.find(file => file.p === 'lib/services/order-step-5.ts').n, invoice.id)
    assert.equal(data.nodes.find(node => node.id === invoice.id).name, 'Fatture')
    // con names.json, i blocchi ancora senza nome diventano un avviso
    assert.ok(late.some(warning => warning.includes("draft's automatic names")))
    assert.ok(data.edges.some(edge => edge.label === 'chiede'))

    // spostare tutti i file di una parte la toglie dalla mappa
    assert.ok(map.nodes.some(node => node.id === 'tests'))
    const emptied = applyNames(map, { moves: { 'tests/': invoice.id } }, scan).spec
    assert.ok(!flat(emptied.nodes).some(node => node.id === 'tests'))
    assert.equal(buildData(emptied, scan).stats.assigned, scan.files.length)
    const whole = applyNames(map, { moves: { 'lib/services/customer-': invoice.id } }, scan)
    assert.ok(whole.warnings.some(warning => warning.includes('matches no file')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('la mappa sa se è ancora giusta: niente da fare, solo ridisegnare o aggiornare', () => {
  const root = project({ 'src/a.ts': "import { b } from './b'\n", 'src/b.ts': 'export const b = 1\n', 'src/c.ts': 'export const c = 1\n' })
  const scripts = fileURLToPath(new URL('../skills/map/scripts/', import.meta.url))
  try {
    let scan = scanProject(root)
    assert.equal(mapStatus(root, scan).state, 'none')
    const map = draftMap(scan, { lang: 'en', coChange: new Map() })
    assert.equal(map.fingerprint, fingerprintOf(scan))
    mkdirSync(join(root, '.pharos'))
    writeFileSync(join(root, '.pharos', 'map.json'), JSON.stringify(map))
    assert.equal(mapStatus(root, scan).state, 'render')
    writeFileSync(join(root, '.pharos', 'map.html'), '<!doctype html>')
    const later = new Date(Date.now() + 5000)
    utimesSync(join(root, '.pharos', 'map.html'), later, later)
    assert.equal(mapStatus(root, scan).state, 'fresh')
    // cambia il codice: la mappa va aggiornata
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2\n')
    scan = scanProject(root)
    assert.notEqual(fingerprintOf(scan), map.fingerprint)
    assert.equal(mapStatus(root, scan).state, 'changed')
    // una mappa scritta a mano si ridisegna così com'è
    writeFileSync(join(root, '.pharos', 'map.json'), JSON.stringify({ nodes: [] }))
    assert.equal(mapStatus(root, scan).state, 'hand')
    // riaprire una pagina che non c'è dice di farla prima
    const empty = project({ 'x.ts': '' })
    const run = spawnSync(process.execPath, [join(scripts, 'render.mjs'), empty, '--open'], { encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /no page/)
    rmSync(empty, { recursive: true, force: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
