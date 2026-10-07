# Campaign Hub

A tool for generating new homebrew D&D campaigns (NPCs, locations, quests,
items, factions, lore) and procedural maps (region/overworld + dungeon/battle),
piece by piece, one campaign at a time.

**This never reads from or writes into your real Obsidian vault.** It's
modeled on the same tag/frontmatter/folder conventions your vault uses, but
generated campaigns live in their own datastore. Use **Download .md** on any
note to pull it into your real vault whenever you want it there.

## Architecture

This is a static frontend, deployed via GitHub Pages (repo root, `main`
branch — GitHub Pages' classic UI only supports root or `/docs`, so
`index.html` lives at the repo root, not in a subfolder) to
`campaign.barnyard.site`, talking to `/campaign/*` routes on the existing
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

Just the static frontend, at repo root:

```
index.html, styles.css, app.js   hash-routed SPA, no build step
lib/
  api.js                 fetch() wrapper, points at api.barnyard.site/campaign
  wikilink.js             [[..]] / ![[..]] rendering + note-to-.md download
  noise.js                 seedable PRNG + value-noise (map generators)
views/
  library.js, campaign.js, new-note.js, map-dungeon.js, map-overworld.js
preview-server.ps1    local static-file server for previewing the site during dev
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

## Shared shell and themes (2026-10-08)

The app now sits in the same shell as the dashboard: a left sidebar (Overview, Ops board, Study, Campaign, Stocks), a top bar (jump search, light/dark, Settings) and a Settings panel with 18 colour themes, 18 page backgrounds, density and sidebar options. The choice follows you between barnyard.site pages through a small `bh_prefs` cookie (look-and-feel keys only, validated on read).

- `themes.js`, `shell.js`, `shell.css` and `fonts/` are **hand-copied unchanged from barnyard-hub**, like `auth-gate.js`. Change them there and copy them out again. `test/shell.test.js` checks them (every theme readable in both modes, every background has CSS, the page stays inside its CSP). Run it with `node test/shell.test.js`.
- `styles.css` is now only this app's layout and the class names its views use; colours come from the shell's tokens. The old header is gone: Library, Dungeon map and Overworld map are a tab strip under the page title (`app.js` marks the current one).
- Maps still draw on black paper whatever the theme. Beside the controls the canvas may now shrink to fit the row, keeping its shape (the overworld's pointer maths already scales by the canvas's on-screen size).
- Script order matters: `themes.js` in `<head>`, `shell.js` before `auth-gate.js` (it creates `#auth-status`). All script and stylesheet tags share the `?v=50` cache-bust.
## Map generator

Two independent modes (not linked to content generation):

- **Overworld/region**: value-noise heightmap → biomes → settlements → roads.
- **Dungeon/battle**: BSP tree room-and-corridor generator.

Both let you regenerate with a new seed, export a PNG directly to your
downloads, or save into the active campaign on the server. Map saves never
auto-edit any note — you get the exact `![[filename.png]]` text to paste in
yourself.

### Settings follow the signed-in user (2026-10-07)

The copied `themes.js` now also syncs the look-and-feel settings with the signed-in user's profile (Worker `GET/PUT/DELETE /prefs`), so a theme chosen in one browser loads in any other. `shell.js` shows the status in the Settings footer (a **Sign in** link when signed out, **Remove saved profile**). Nothing is sent when signed out. `themes.js`, `shell.js` and `shell.css` are hand-copied unchanged from `barnyard-hub`; do not edit them here.
