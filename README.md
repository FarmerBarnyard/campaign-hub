# Campaign Hub

A local tool for generating new homebrew D&D campaigns (NPCs, locations, quests,
items, factions, lore) and procedural maps (region/overworld + dungeon/battle),
piece by piece, one campaign at a time.

**This never reads from or writes into your real Obsidian vault.** It generates
brand-new campaigns as their own Obsidian-compatible notes, in a separate folder
you choose, following the same tag/frontmatter/folder conventions so you can add
that folder as its own vault in Obsidian and get Dataview/graph/search on
generated content for free.

## Why PowerShell, not Node

This machine has no Node/npm/npx and no working Python. The backend is a small
PowerShell `HttpListener` server; the frontend is plain HTML/CSS/JS with no
build step. See `dash_server.ps1` (sibling project) for the original pattern
this extends.

## Setup

1. Copy `config.example.json` to `config.local.json`.
2. Set `campaignsRoot` to wherever you want generated campaigns to live (default
   `S:\DND\Generated Worlds` — a sibling of, and entirely separate from, any
   existing vault). The folder is created automatically on first run if it
   doesn't exist.
3. To enable the "Generate draft with Claude" button, set `apiKey` to an
   Anthropic API key. **Set a spend limit on that key in the Anthropic Console
   first** — this tool also has its own local daily cap (`dailySpendCapUsd`,
   `maxGenerationsPerDay` in the config) as a soft safety net, but the real
   backstop is your own account-level limit.
4. Without an API key, everything else still works — browsing, manual note
   creation, and both map generators don't need Claude at all.

## Running it

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
```

Then open `http://localhost:8790/` (or whatever port you set).

## How content generation works

Pick a campaign (or create one) → pick a kind (Location, Entity, Quest, Item,
Religion, Spell, Status Effect, Material) → write a one-line brief and
optional tone → **Generate draft** fills in the form from Claude, or leave it
blank and write the note by hand. Either way, nothing is written to disk until
you click **Save** — and Save always refuses to overwrite an existing note
(you'll get an inline error instead), so nothing you've already generated can
be silently clobbered.

## Map generator

Two independent modes (not linked to content generation):

- **Overworld/region**: value-noise heightmap → biomes → settlements → roads.
- **Dungeon/battle**: BSP tree room-and-corridor generator.

Both let you regenerate with a new seed, export a PNG directly to your
downloads, or save straight into the active campaign's `Images/` folder. Map
saves never auto-edit any note — you get the exact `![[filename.png]]` text
to paste in yourself.

## Project layout

```
server.ps1              entry point
config.example.json     checked in; copy to config.local.json (gitignored)
usage.json              gitignored, generated: daily Claude usage ledger
modules/
  OutputFs.ps1           path-safety + file I/O, confined to campaignsRoot
  Frontmatter.ps1        minimal YAML frontmatter parse/serialize
  TypeSchemas.ps1        static content-type schema (tag/folder/fields per kind)
  ClaudeClient.ps1       Claude API call, prompt, usage ledger, guardrails
  Routes.ps1             API route table
www/
  index.html, styles.css, app.js   hash-routed SPA, no build step
  lib/
    api.js                fetch() wrapper
    wikilink.js            [[..]] / ![[..]] rendering
    noise.js                seedable PRNG + value-noise
  views/
    library.js, campaign.js, new-note.js, map-dungeon.js, map-overworld.js
```
