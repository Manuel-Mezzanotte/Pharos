import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { outline, parseJsonc, scanProject } from '../skills/map/scripts/scan.mjs'

// Crea un progetto finto da un elenco { percorso: contenuto }.
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'pharos-test-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

function linksOf(scan) {
  return Object.fromEntries(scan.files.filter(file => file.imports.length > 0).map(file => [file.path, file.imports]))
}

test('JS/TS: relativi, index, .js che punta a .ts, alias di tsconfig e pacchetti esterni', () => {
  const root = project({
    'tsconfig.json': '{ // commento\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, }, "$schema": "https://x.dev/y" }',
    'src/app.ts': "import { a } from './lib/a.js'\nimport b from '@/lib/b'\nimport { c } from './ui'\nimport React from 'react'\nimport fs from 'node:fs'\nimport z from 'zod/v4'\nconst d = await import('./lazy')\n",
    'src/lib/a.ts': "export const a = 1\n",
    'src/lib/b.ts': "import type { T } from '../types'\nexport const b = 2\n",
    'src/types/index.d.ts': 'export type T = 1\n',
    'src/ui/index.tsx': "export const c = 3\n",
    'src/lazy.ts': "require('@/lib/a')\n",
  })
  try {
    const scan = scanProject(root)
    assert.deepEqual(linksOf(scan), {
      'src/app.ts': ['src/lazy.ts', 'src/lib/a.ts', 'src/lib/b.ts', 'src/ui/index.tsx'],
      'src/lazy.ts': ['src/lib/a.ts'],
      'src/lib/b.ts': ['src/types/index.d.ts'],
    })
    assert.deepEqual(scan.files.find(file => file.path === 'src/app.ts').externals, ['react', 'zod'])
    assert.equal(scan.files.find(file => file.path === 'src/lib/a.ts').importedBy, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('JS/TS: i pacchetti di un monorepo si risolvono nelle loro cartelle', () => {
  const root = project({
    'package.json': '{ "name": "root", "workspaces": ["packages/*"] }',
    'packages/ui/package.json': '{ "name": "@acme/ui", "main": "dist/index.js", "source": "src/index.ts" }',
    'packages/ui/src/index.ts': "export * from './button'\n",
    'packages/ui/src/button.ts': 'export const Button = 1\n',
    'packages/ui/src/forms/field.ts': 'export const Field = 1\n',
    'apps/web/src/main.ts': "import { Button } from '@acme/ui'\nimport { Field } from '@acme/ui/forms/field'\nimport left from 'left-pad'\n",
  })
  try {
    const scan = scanProject(root)
    const main = scan.files.find(file => file.path === 'apps/web/src/main.ts')
    assert.deepEqual(main.imports, ['packages/ui/src/forms/field.ts', 'packages/ui/src/index.ts'])
    assert.deepEqual(main.externals, ['left-pad'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Python: import assoluti, relativi e sottomoduli; la libreria standard non conta', () => {
  const root = project({
    'backend/app/__init__.py': '',
    'backend/app/main.py': 'import os\nimport requests\nfrom app import models\nfrom .services import billing\nfrom . import utils\nfrom app.db import session as s\n',
    'backend/app/models.py': 'x = 1\n',
    'backend/app/utils.py': 'x = 1\n',
    'backend/app/db/__init__.py': '',
    'backend/app/db/session.py': 'x = 1\n',
    'backend/app/services/__init__.py': '',
    'backend/app/services/billing.py': 'import stripe\n',
  })
  try {
    const scan = scanProject(root)
    const main = scan.files.find(file => file.path === 'backend/app/main.py')
    assert.deepEqual(main.imports, [
      'backend/app/db/session.py',
      'backend/app/models.py',
      'backend/app/services/billing.py',
      'backend/app/utils.py',
    ])
    assert.deepEqual(main.externals, ['requests'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Go: i pacchetti del modulo puntano alla loro cartella, il resto è esterno', () => {
  const root = project({
    'go.mod': 'module github.com/acme/shop\n\ngo 1.22\n',
    'cmd/api/main.go': 'package main\n\nimport (\n\t"fmt"\n\t"github.com/acme/shop/internal/store"\n\tlog "github.com/rs/zerolog"\n)\n',
    'internal/store/store.go': 'package store\n\nimport "github.com/lib/pq"\n',
  })
  try {
    const scan = scanProject(root)
    const main = scan.files.find(file => file.path === 'cmd/api/main.go')
    assert.deepEqual(main.imports, ['internal/store/store.go'])
    assert.deepEqual(main.externals, ['github.com/rs/zerolog'])
    assert.deepEqual(scan.files.find(file => file.path === 'internal/store/store.go').externals, ['github.com/lib/pq'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Rust, Java, C e CSS: i collegamenti più comuni', () => {
  const root = project({
    'Cargo.toml': '[package]\nname = "tool"\n',
    'src/main.rs': 'mod config;\nuse crate::db::open;\nuse serde::Deserialize;\nfn main() {}\n',
    'src/config.rs': 'pub fn load() {}\n',
    'src/db/mod.rs': 'pub fn open() {}\n',
    'app/src/com/acme/Main.java': 'package com.acme;\nimport com.acme.util.Log;\nimport java.util.List;\nimport org.springframework.boot.App;\n',
    'app/src/com/acme/util/Log.java': 'package com.acme.util;\n',
    'native/main.c': '#include "util.h"\n#include <stdio.h>\n',
    'native/util.h': '',
    'web/site.scss': "@use 'parts/nav';\n@import './base.css';\n",
    'web/parts/_nav.scss': 'a {}\n',
    'web/base.css': 'a {}\n',
  })
  try {
    const scan = scanProject(root)
    const by = path => scan.files.find(file => file.path === path)
    assert.deepEqual(by('src/main.rs').imports, ['src/config.rs', 'src/db/mod.rs'])
    assert.deepEqual(by('src/main.rs').externals, ['serde'])
    assert.deepEqual(by('app/src/com/acme/Main.java').imports, ['app/src/com/acme/util/Log.java'])
    assert.deepEqual(by('app/src/com/acme/Main.java').externals, ['org.springframework'])
    assert.deepEqual(by('native/main.c').imports, ['native/util.h'])
    assert.deepEqual(by('web/site.scss').imports, ['web/base.css', 'web/parts/_nav.scss'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('si saltano node_modules, build e file nascosti; le righe si contano', () => {
  const root = project({
    'src/a.ts': 'one\ntwo\nthree\n',
    'node_modules/x/index.js': 'x\n',
    'dist/a.js': 'x\n',
    '.env': 'SECRET=1\n',
    'src/data.json': '{}',
  })
  try {
    const scan = scanProject(root)
    assert.deepEqual(scan.files.map(file => file.path), ['src/a.ts'])
    assert.equal(scan.files[0].loc, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseJsonc: commenti, virgole finali e // dentro le stringhe', () => {
  assert.deepEqual(parseJsonc('{ /* a */ "u": "http://x", // b\n "l": [1, 2,], }'), { u: 'http://x', l: [1, 2] })
})

test('la panoramica nomina cartelle, collegamenti e pacchetti', () => {
  const root = project({
    'package.json': '{ "name": "demo", "dependencies": { "react": "1" } }',
    'src/ui/App.tsx': "import { api } from '../api/client'\nimport React from 'react'\n",
    'src/api/client.ts': 'export const api = 1\n',
  })
  try {
    const text = outline(scanProject(root))
    assert.match(text, /# Pharos scan: demo/)
    assert.match(text, /src\/  2 files/)
    assert.match(text, /react 1/)
    assert.match(text, /1 links between files found/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cosa offre un file e il commento che dice a cosa serve', async () => {
  const { exportsOf, aboutOf } = await import('../skills/map/scripts/scan.mjs')
  const ts = "'use client'\n/**\n * Calcola il totale delle spese di un periodo.\n * @param x\n */\nexport async function totale() {}\nexport const IVA = 22\nexport { a as b, type T }\nexport default class Foo {}\n"
  assert.deepEqual(exportsOf(ts, '.ts'), ['totale', 'IVA', 'Foo', 'b', 'T'])
  assert.equal(aboutOf(ts), 'Calcola il totale delle spese di un periodo.')
  assert.deepEqual(exportsOf('def pubblica():\n    pass\n\ndef _privata():\n    pass\nclass Modello:\n    pass\n', '.py'), ['pubblica', 'Modello'])
  assert.equal(aboutOf('"""Legge le fatture dal portale."""\nimport os\n'), 'Legge le fatture dal portale.')
  assert.equal(aboutOf('// app/api/me/route.ts\nexport const GET = 1\n'), undefined)
  assert.equal(aboutOf('// Copyright 2026 Acme. All rights reserved.\n'), undefined)
})
