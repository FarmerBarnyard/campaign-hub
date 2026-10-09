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

### Hides what a guest cannot use (2026-10-08)

The copied `themes.js` now also reads the Worker's `/auth/session` (`BarnyardTheme.who`: signed in, hub owner or not, which apps their groups allow), and `shell.js` hides the **Study** and **Campaign** links (and their jump-search results) from a signed-in person whose groups don't include them. It is a display hint only, fails open when unknown, and every route still checks its own group. `themes.js`, `shell.js` and `shell.css` are hand-copied unchanged from `barnyard-hub`; do not edit them here.

### Reads send the login cookie (2026-10-08)

`lib/api.js` now sends the login cookie on reads (`Api.get`) as well as writes, so a signed-in guest reads their own campaigns: the Worker (ClaudeRepo PR 307) gives each signed-in guest in the Campaign group their own space for notes, images and daily limits. Not signed in, nothing is sent and reads are the open, shared space exactly as before. `node test/api.test.js` guards it.

Security audit 2026-10-08 (R2, R3): saved note images are now loaded with `crossOrigin="use-credentials"` (`lib/wikilink.js`), because the Worker requires the Campaign login for `/campaign/image`; this also makes embedded images work, which the Worker's Origin check had been refusing for plain `<img>` tags. The map key (`lib/keyed-legend.js`) escapes its labels. Reads of campaigns and notes need a login (ClaudeRepo PR 318), so a signed-out visitor sees an error instead of the owner's campaigns. `node test/images.test.js`.

## Campaign engine (background note generation) -- 2026-10-09

The local model writes at a few tokens a second, so one note takes minutes; asked through a single request that waits, it nearly always timed out. With the **campaign engine** switched on (Worker side and the engine service: ClaudeRepo PR 341 and `engine/README.md`) generation is a background job you come back to.

- **Generate a pack** (on a campaign's page, under the "+ New ..." buttons): a premise, a tone, a size (6, 12 or 24 notes) and which kinds of note. The engine writes a short world bible, plans the notes, then writes each one; progress shows live (what it is writing, how many are done, how long it has taken), a note that fails does not stop the rest, and Cancel keeps what was written. Each draft opens for review and editing (title, folder, text); tick the ones you want and **Save selected**. Nothing is saved until you do, a name that is already taken gets "(2)" rather than overwriting, and drafts only link to notes that exist (a pack's own notes and the campaign's existing ones; any other link is plain text).
- **New note, Generate draft:** with the engine running, the same button queues a job and fills the form when it is done (title included), with a Cancel button. With the engine switched off or offline it falls back to the old direct route (and says so), which may still time out.
- The panel shows only when the Worker has `CAMPAIGN_ENGINE_ENABLED`; it says "Engine online/offline", how many generated notes are left today, and keeps your jobs for 14 days.
- New files: `lib/engine.js` (wording, paths, polling rules, the API calls), `views/jobs.js` (the panel and the single-note job). Everything a model wrote goes in through `textContent` / `.value`, never as markup. Cache version `?v=54`.
- Tests: `node test/engine.test.js` (10), plus the existing three. Checked in a real browser against a fake Worker and engine (queue a pack, live progress, a failed note, review and edit, save with a name clash, Cancel, the single-note job, the offline fallback).

## Linking maps and notes -- 2026-10-09

A saved map used to be only a picture (`Images/<name>.png`): nothing said how it was made, and a note could reach it only if you pasted its image link by hand. Now **Save to campaign** also writes a small **map note** beside the picture (`Maps/<name>.md`, see `lib/map-link.js`):

```
---
tags: [M]
Map_Type: settlement
Map_Route: map/settlement
Map_Params: seed=2023872551&idx=0&name=Saltgate&tier=city      the same URL parameters the page uses
Image: Saltgate.png
Location: Saltgate                                              the note it was drawn for, if any
---
# Saltgate
![[Saltgate.png]]
Location: [[Saltgate]]
```

- **It is an ordinary note.** It shows in the library under Maps, can be linked from any note with `[[Saltgate]]`, and shows its picture. No Worker change: notes were always free-form frontmatter plus a body.
- **Open map:** a map note whose frontmatter carries `Map_Route` and `Map_Params` gets an **Open map** button that redraws the very same map. Only the generators whose whole state is in the page address are reopenable (settlement, detail, landmark); overworld and dungeon maps are saved as a picture with a note that says so. The route must be a known generator and the parameters a plain query string, or no button is shown.
- **Draw a settlement map:** a Location note (tag A) offers a size (village, town, city) and a button that opens the settlement generator seeded from the note's title, so the same place always draws the same town. The campaign is preselected, the file is named after the place, "Back" leads to the campaign, and Save links the map note back to the Location (`Location: [[Saltgate]]`). Notes are write-once on the server, so the link is made from the map note's side.
- A map note name that is taken gets "(2)"; a failure writing the note never undoes the picture. The parameters sent to the render service never include the campaign or location.
- New file `lib/map-link.js`; `wireMapExportSave` takes an optional map description; cache version `?v=55`.
- Tests: `node test/map-link.test.js` (11). Checked in a real browser against a fake Worker: draw from a Location note, the pre-filled campaign and file name, Save (picture and map note), a second Save (numbered), and opening the saved map from its note.
