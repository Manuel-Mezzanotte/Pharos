# Pharos

**An interactive map of any codebase, made for the person reading it.**

Open one page and understand in seconds what a project is made of and how its parts talk to each other: a few blocks with plain names (pages, API, logic, data, outside services…), the arrows between them, and sections that open to show each block's parts. Clean, Apple-style, light and dark.

Pharos is a plugin for [Claude Code](https://claude.com/claude-code). An algorithm builds the structure from the code; Claude only gives it names. Same code, same map.

## Install

In Claude Code:

```
/plugin marketplace add Manuel-Mezzanotte/Pharos
/plugin install pharos@pharos
```

To get updates later: `/plugin marketplace update pharos`.

## Use

In any project:

| Command | What it does |
| --- | --- |
| `/pharos:map` | Makes the map the first time. Later: reopens it when the code didn't change, updates it when it did. |
| `/pharos:map open` | Reopens the page, without redoing anything. |
| `/pharos:map update` | Refreshes the map even if the code looks the same. |
| `/pharos:map new` | Makes the map again from scratch, names included. |

Asking in words works too: "make a map of this project", "open the map again".

Everything goes in `<project>/.pharos/`, which ignores itself in git. The page is `.pharos/map.html`: double-click it to open it without Claude.

### A shorter `/map`

Claude Code puts the plugin name in front of a plugin's commands. To type just `/map`, create `~/.claude/skills/map/SKILL.md`:

```markdown
---
name: map
description: Short command for Pharos, the interactive map of a project.
argument-hint: "[open | new | update] [project folder]"
disable-model-invocation: true
---

Run the Pharos skill now: invoke the `pharos:map` skill with the Skill tool, passing these arguments unchanged: $ARGUMENTS
```

## On the page

- Three levels in the bar:
  - **Simple:** only the main blocks and outside services, for explaining the project.
  - **Normal:** blocks and parts.
  - **Detail:** every part you open shows its files, with the arrows file by file.
- Click a block to open its section, hover it to light up its arrows, click a part to list its files.
- Shift-click a second block or file: the way between them lights up.
- ⌘K or `/` searches blocks, files and functions.
- The minimap (top right) moves the view.
- The settings button sets the theme (auto, light, dark), the accent colour, the minimap, the names on arrows and animations.
- `?` lists the keyboard shortcuts.

## How it works

1. **Scan.** `scan.mjs` lists the files, reads which file imports which, finds calls to the project's own API (`fetch('/api/…')`) and the addresses the code reaches.
2. **Draft.** `draft.mjs` builds the map:
   - every file gets a layer (pages, API, components, logic, data, shared, tests, tooling);
   - pages and API follow the app's routes, the rest follows the folders;
   - big flat folders split by the words their file names share;
   - small groups join the ones they talk to most (imports, API calls, files changed together in git, shared words);
   - outside services come from the packages and addresses the code uses.
3. **Words.** Claude reads the draft and writes `names.json`: a name and a sentence for every block and part, and the arrows worth naming.
4. **Page.** `render.mjs` checks everything and writes one self-contained HTML page.

## Needs

Node.js 18 or newer, no dependencies. It works best on JavaScript and TypeScript, where it follows Next.js, SvelteKit and Nuxt routes. Imports are also read for Python, Go, Rust, Java/Kotlin, C, Dart and CSS.

## Develop

```bash
node --test 'test/*.test.mjs'
```

## License

[MIT](LICENSE) © Manuel Mezzanotte
