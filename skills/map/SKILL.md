---
name: map
description: Draw an interactive, Apple-style map of a codebase — a graph of the project's main blocks (interface, API, data, outside services…) and how they connect, in a browser page where each block opens and closes to show its parts. Use when the user wants to understand how a project is organised or fits together ("mappa del progetto", "grafo del progetto", "come è fatto questo progetto", "show me the architecture", "dependency map", "project overview"), or asks to refresh a map made before. The map is for the person reading it, not for you.
argument-hint: "[open | new | update] [project folder]"
---

# Pharos: a map of the project, for the person

A person who has never seen this code should open one page and understand, in seconds, what the project is made of and how the parts talk to each other: **a few blocks with plain names, and arrows between them**, from top (what people use) to bottom (data and outside services). Clicking a block opens its **section** with its **parts**: groups of files on one topic, never one node per file. Clicking a part shows its files in a side panel.

An algorithm draws the structure; you give it words.

- `draft.mjs` reads the code and builds the whole map: which block each file goes in, the parts inside each block, the outside services, and every arrow (imports and calls to the project's own API). Same code, same map. It names everything automatically, from folder and file names.
- You read what it found, understand the project, and write `.pharos/names.json`: a real name and one sentence for every block and part, and the 8–15 arrows worth naming.
- `render.mjs` puts the two together and draws the page.

Paths below are relative to this skill's folder: the "Base directory for this skill" line shown when it loaded. `<root>` is the project folder: a folder given in the arguments, else the current working directory. The scripts need Node.js 18 or newer. Write every name and sentence in the language the person writes to you in, and pass that language to the draft: `it` for Italian, `en` for anything else.

## 0. Start here: what does the person want?

The arguments may hold one word, `open`, `new` or `update`, and/or a project folder. A request in words counts the same: "open the map again" is `open`, "redo the map from scratch" is `new`.

- **`open`**: show the page that already exists, without redoing anything:
  ```bash
  node <skill>/scripts/render.mjs <root> --open
  ```
  Tell the person in one line that it is open. If it says there is no page yet, make the map (as with no word).
- **`new`**: make the map from scratch, names included. Run step 1 with `--force` and write a whole new `names.json` (steps 2–5), replacing the old one.
- **`update`**: refresh the map even if the check below says it is up to date: follow "Refreshing a map".
- **No word**: ask the scripts what is needed:
  ```bash
  node <skill>/scripts/draft.mjs <root> --check
  ```
  It prints one line; its first word says what to do.
  - `none`: there is no map yet. Make it: steps 1–5.
  - `fresh`: nothing changed since the last map. Run `render.mjs <root> --open` and tell the person in one line that the map is up to date and open.
  - `render`: the code didn't change, but the page is older than the names. Run step 4 and tell them in one line.
  - `changed`: the code changed. Follow "Refreshing a map".
  - `hand`: a hand-written map. Run step 4 as it is.

## 1. Draft the map

```bash
node <skill>/scripts/draft.mjs <root> --lang it
```

It writes `<root>/.pharos/map.json` and prints what it built:

- every block and part as `id · automatic name · files · folder · subfolders (with their files) and telling file names`. `(opens)` marks a part with parts of its own;
- `joins: A | B` marks a part the algorithm made from smaller groups; `leftovers` marks the files of a folder that no other part took, so they are mixed;
- the outside services it recognised: from the packages the code imports, from well-known addresses it calls (an AI provider's API) and from variables like `PAYMENTS_SERVICE_URL`, which point to another service of the same product;
- the addresses the code calls that are not a known service, with the parts that call them: decide which ones are real outside services;
- the strongest arrows between blocks, outside services included.

To see every file of one part, with its lines and its top comment: `node <skill>/scripts/draft.mjs <root> --part <id>`.

How it cuts, so you can read the result:

- **Blocks are layers**: Pages, API, Components, Logic, Data, Shared, Tests, Tooling (each only if the project has it), plus outside services.
- **Pages and API follow the app's routes** (Next.js, SvelteKit, Nuxt), so every page has its place; `[id]` folders stay with their section.
- **Other blocks follow the folders.** A big flat folder is split by the words its file names share (`expense-*`, `invoice-*`).
- **Small or too many groups join** the group they talk to most: imports, API calls, files changed together in git, shared words.

If the script says `map.json` was written by hand, an older map exists: skip to step 4 and draw it as it is.

## 2. Understand the project

Read the README and 3–6 key files: the main manifest, an entry point, a file or two from the biggest parts. When the README says little (a framework's default text), read `CLAUDE.md` or `AGENTS.md` instead: projects often describe themselves there. The subfolders and file names in the draft's list usually tell what a part is about; for a part they don't explain, use `--part <id>` (above). Don't read code in bulk.

## 3. Write the words: `<root>/.pharos/names.json`

```json
{
  "title": "Shop",
  "lang": "en",
  "summary": "An online shop: customers browse and pay, staff manage orders.",
  "nodes": {
    "pages": { "name": "Storefront", "summary": "The pages customers see: catalogue, cart, checkout." },
    "pages-orders": { "name": "Orders", "summary": "Order history and order details.", "about": "Optional: one to three more sentences for the side panel." },
    "logic-invoice": { "name": "Invoices", "summary": "Builds invoices and sends them by email." },
    "stripe": { "name": "Stripe", "summary": "Takes the payments." }
  },
  "services": [
    { "id": "supplier-api", "name": "Supplier API", "summary": "Tells which products are in stock.", "reach": ["api.supplier.example"] }
  ],
  "links": [
    { "from": "pages", "to": "api", "label": "asks for data" },
    { "from": "logic-invoice", "to": "stripe", "label": "charges with" },
    { "from": "logic-invoice", "to": "supplier-api", "label": "checks stock" }
  ],
  "moves": { "lib/services/receipt.ts": "logic-invoice" }
}
```

- **Every id the draft printed gets an entry**, blocks, parts and outside services alike. Use the ids exactly as printed; write `"id": "Name"` when the summary can stay as the draft wrote it (outside services).
- `name`: 1–3 plain words, in the reader's terms ("Expenses", "Login and permissions"), not folder names. A person who doesn't code should get it. Parts with the same name in different blocks are fine: the page shows which block they belong to.
- **A joined part (`joins: A | B`) gets one name that covers all of it** ("People" for staff, shifts and contracts).
- **A `leftovers` part** (the draft calls them "Base" or after a folder) holds what was left in a folder. Look at its files and name it after what most of them are about ("Users and jobs"). If a few clearly belong elsewhere, move them.
- **No catch-all names**: never "Other", "Misc", "Various", "Rest": the reader can't tell what is inside. The script flags them.
- `summary`: one sentence about what the block does for the people using the project, under ~80 characters, no jargon, no file names.
- `kind` changes a block's colour and icon when the draft got it wrong: `interface`, `api`, `logic`, `data`, `external`, `shared`, `tooling`, `test`, `docs`, `other`.
- `services` adds the outside services the draft could not name: a portal, a partner's API, another app of the same company. Each has an `id`, a `name`, a `summary` and, when the draft listed its address, `reach`: those hosts or variable names (`"reach": ["portal.example.gov"]`), so its arrows draw themselves. Without `reach`, draw its arrows with `links`. The README often names the services a project talks to. Rename a service the draft got wrong (a storage service reached through another vendor's library) in `nodes`.
- `links` name the arrows that tell the story, 8–15 of them, with a short verb as `label` (1–3 words). The code already draws every arrow: a link gives one a name, or adds one the code can't show (a queue, a redirect, a service in `services`). Link at the level where the label is true: a link between two blocks also covers the arrows between their parts. Render lists the links it had to add, so you can check them.
- `moves` put a file (or a glob, or a folder ending in `/`) into another part, or into a block without parts, by id, when the draft clearly placed it wrong: a background worker kept in `scripts/`, a design note among the tests. Use it rarely: the structure comes from the code.
- `lang` is `"it"` or `"en"` and sets the page's own buttons; it wins over the draft's `--lang`, which only sets the automatic names.

## 4. Draw it

```bash
node <skill>/scripts/render.mjs <root>
```

It reads `map.json` and `names.json`, checks them, writes `<root>/.pharos/map.html` and opens it in the browser. It prints the files per block, how your links landed (and which ones it had to add) and every problem. Fix every `WARNING:` (an unknown id, a block still without a name, a catch-all name) in `names.json` and run it again; `note:` lines are optional. Stop after three runs.

## 5. Tell the person

Four to six lines in their language:

- the page opened in the browser, and its path;
- the main blocks, and in one sentence how they fit together;
- how to use it: click a block to open its section, hover one to light up its links, click a part for its files, ⌘K to search blocks, files and functions; the minimap (top right) moves the view, the settings button sets theme and colour, `?` lists the shortcuts;
- to see it again, `/map open` (or open `.pharos/map.html`); after the code changes, `/map` updates it and only reopens it when nothing changed. If the person has no `/map` command, say `/pharos:map` instead.

Don't paste the JSON, don't list every block, and don't mention warnings you fixed.

## Refreshing a map

A map was made before and the code changed: run step 1 again (it keeps the language of the last map), then step 4. The draft places new files by itself and keeps the ids of what didn't change, so the names in `names.json` stay. Add names only for what render reports as still automatic; a name for an id that no longer exists is reported too: move it to the new id the draft printed. Then tell the person in two or three lines what changed (new parts, services, arrows), not the whole map again.

If there is no `names.json` yet (the draft was run on its own), write it as in step 3.

## A hand-written map

A `map.json` without the `"generator"` line was written by hand (by an early version, or on purpose). The draft leaves it alone; `render.mjs` draws it directly. Its format is the same as the draft's: `nodes` with `id`, `name`, `kind`, `summary`, and either `paths` (`"src/api/"` a folder, `"src/main.ts"` a file, `"lib/services/expense-*"` or `"**/*.test.ts"` a glob; an exact file beats a glob, a glob beats a folder, a deeper folder beats a shallower one), `children` (its parts) or `packages` (an `external` block's libraries, `"@stripe/*"` allowed). To switch it to the algorithm, run the draft with `--force` and write `names.json`.
