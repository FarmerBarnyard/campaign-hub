# Campaign Hub

A tool for generating new homebrew D&D campaigns (NPCs, locations, quests,
items, factions, lore) and procedural maps (region/overworld + dungeon/battle),
piece by piece, one campaign at a time.

**This never reads from or writes into your real Obsidian vault.** It's
modeled on the same tag/frontmatter/folder conventions your vault uses, but
generated campaigns live in their own datastore. Use **Download .md** on any
note to pull it into your real vault whenever you want it there.

## Architecture

This is a static frontend (`www/`, deployed via GitHub Pages to
`campaign.barnyard.site`) talking to `/campaign/*` routes on the existing
shared Cloudflare Worker at `api.barnyard.site` (the same Worker already
serving `/price`, `/calendar`, `/generate-notes` — see
`../ClaudeRepo/cloudflare-worker/`). That Worker is the source of truth for
routes, storage (Cloudflare R2), and the daily-generation counter
(Cloudflare KV) — there's nothing to run locally to use the deployed site.

**Content generation runs on a self-hosted Ollama instance, not a paid API.**
The Worker reaches it over a Cloudflare Tunnel from the user's own VM
(CPU-only, 24GB RAM), gated by a Cloudflare Access service token so nothing
but the Worker can reach it — Ollama itself has no built-in auth, so this
gate is load-bearing, not optional. See `../ClaudeRepo/cloudflare-worker/README.md`
for the Worker-side setup once those routes exist.

## This repo's contents

Just the static frontend:

```
www/
  index.html, styles.css, app.js   hash-routed SPA, no build step
  lib/
    api.js                 fetch() wrapper, points at api.barnyard.site/campaign
    wikilink.js             [[..]] / ![[..]] rendering + note-to-.md download
    noise.js                 seedable PRNG + value-noise (map generators)
  views/
    library.js, campaign.js, new-note.js, map-dungeon.js, map-overworld.js
preview-server.ps1    local static-file server for previewing www/ during dev
                      (no API logic here any more -- that's all on the Worker)
```

## Local preview

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File preview-server.ps1
```

Then open `http://localhost:5180/`. This only serves the static files — every
API call still goes out to the real `api.barnyard.site/campaign/*` Worker
routes, so generation/save/etc. only work once those are deployed.

## Content generation flow

Pick a campaign (or create one) → pick a kind (Location, Entity, Quest, Item,
Religion, Spell, Status Effect, Material) → write a one-line brief and
optional tone → **Generate draft with Ollama** fills in the form (CPU
inference on a self-hosted model — expect 30–90s or longer, not the
sub-20-second latency a hosted API gives you), or leave it blank and write
the note by hand. Either way, nothing is written until you click **Save**,
which always refuses to overwrite an existing note (inline error instead) so
nothing already generated can be silently clobbered.

## Map generator

Two independent modes (not linked to content generation):

- **Overworld/region**: value-noise heightmap → biomes → settlements → roads.
- **Dungeon/battle**: BSP tree room-and-corridor generator.

Both let you regenerate with a new seed, export a PNG directly to your
downloads, or save into the active campaign on the server. Map saves never
auto-edit any note — you get the exact `![[filename.png]]` text to paste in
yourself.
