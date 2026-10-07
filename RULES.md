# Map rules

The visual specification every generated map must satisfy. This is the document to argue
with: change a rule here and the generator changes to match, rather than the other way round.

Rules exist because the failures on this project were not matters of taste. Buildings drawn
55% larger than their plot, streets completely hidden under those buildings, a town footprint
over open water, ground texture at one flat density wall to wall, a city on a headland that
could not hold one — every one of those is measurable, and none of them was measured. So each
rule below is paired with a check that runs on every render.

**HARD** rules block a render. The service re-rolls its internal layout streams (never the
user's seed, which must stay stable) and retries; if it still cannot satisfy them it serves
the best attempt and logs the violation.
**SOFT** rules are recorded and reported by the audit harness but never block.

### Reference basis

Three published idioms, not one, since all three were reference points for this project at
different times:

1. **WotC / Mike Schley pictorial settlement maps** (primarily Phandalin, examined at high
   zoom rather than from memory) — hand-inked oblique building icons, one light direction,
   varying hachure, haloed serif labels with leader lines.
2. **Inkarnate / Wonderdraft painted cartography** — layered washes, painted forest and
   mountain masses with internal tonal variation, drawn-not-computed coastlines.
3. **Azgaar-style political/region maps** — clear landmass silhouette, legible boundaries,
   rivers that flow downhill and merge, a hierarchy of settlement markers.

These rules describe **technique** — how such maps are drawn — so the generator produces
original work in the idiom. No third-party map artwork is stored in this repo or shipped
with the application, and no rule here asks for a reproduction of any particular map.

The conventions all three share are the ones that matter most, and are where the generated
output has consistently fallen down: nothing is radially symmetric; density varies across
the map; every element belongs to a structure (buildings line streets, rivers run downhill);
and the frame is composed, with surrounding context rather than a subject floating on blank
paper.

### Which of these are actually enforced

A rule written here but not implemented in `mapgen/src/rules.js` is checked by nobody, and is
more dangerous than a rule that was never written, because a passing audit then reads as
coverage it does not have. B4 is the worked example: it sat here as "buildings sit along
streets" while a contact sheet plainly showed them scattered across open ground, and the
audit reported a clean pass throughout.

So the implemented set is stated explicitly, and any claim that "the audit passes" means only
this set:

**Enforced:** G1, G2, B1, B3, B4, B5, S1, L2, L3, L5, C2, C3
**Written but not yet enforced:** G3, G4, B2, B6, S2–S5, W1–W5, V1, V2, L1, L4, C1, K1–K3

The unenforced ones are the backlog, in roughly that order. Until a rule moves to the first
list, the only thing standing behind it is somebody looking at the map.

---

## 1. Ground

**G1 — The ground is drawn, not filled.** HARD
Every land area carries visible hand-drawn contour hachure that follows the terrain, not a
flat colour with a light grain over it.
*Check:* mean ink coverage over land is within `[0.06, 0.28]`. Below reads as bare fill,
above as a solid mat.

**G2 — Ground texture varies across the map.** HARD
Hachure thickens and thins in coherent patches. It never reads as one uniform straw mat, and
there is always some genuinely open ground for the eye to rest on.
*Check:* divide land into a grid of tiles; the standard deviation of per-tile ink coverage is
≥ 0.03, and at least 8% of land tiles are below half the mean coverage.

**G3 — Ground belongs to its biome.** HARD
A forest town's ground reads green, a barrens town's dusty. One fixed tone everywhere is
wrong.
*Check:* mean interior hue is within 25° of the dominant land biome's reference hue.

**G4 — Water is never hachured.** HARD
*Check:* ink coverage over water below sea level is < 0.01, excluding coastline and river
strokes.

---

## 2. Buildings

**B1 — A building never leaves its plot.** HARD
The drawn silhouette, including roof overhang, gable tips and any outline jitter, stays
inside the footprint allotted to it.
*Check:* no drawn building polygon extends beyond its own allotted rect; no two building
polygons intersect.

**B2 — Buildings read as roofed structures.** HARD
Each has a pitched roof with a light and a dark plane divided by a ridge, a gable end, and a
crisp dark outline. Not a flat coloured tile.
*Check:* per building, the two roof planes differ in luminance by ≥ 12%, and a closed dark
outline is present.

**B3 — One light direction for the whole map.** HARD
Every roof, tree and wall is lit from the same side. Per-building random light direction
reads as noise.
*Check:* the lit roof plane faces the map light direction (up-and-left) for ≥ 98% of
buildings. Note this is "faces the light", not "points the same way": a gable's lit slope is
perpendicular to its ridge, and ridges turn to follow their street, so the lit slopes fan out
even on a correctly lit map — as they do on the reference maps.

**B4 — Buildings sit along streets.** SOFT
They face and cluster on the road network rather than scattering evenly across open ground.
*Check:* ≥ 75% of buildings have their centre within `0.75 × their own longest side + 6px` of
a road centreline. Measured against the building's own size rather than street width, so the
bar means the same thing for a cottage and a cathedral.
*Status:* currently **56–67%** — this is the measurement behind "buildings look scattered
like confetti" on the contact sheet, and the largest open quality gap in the settlement
generator. The orientation half of the original wording (long axis within 25° of the road
tangent) is already enforced in the generator itself, which rotates every plot to face its
nearest road, so it is not re-checked here.

**B5 — Footprints vary.** SOFT
A town is not one repeated stamp. Size and proportion differ noticeably between buildings.
*Check:* coefficient of variation of building area ≥ 0.25.

**B6 — Named buildings read as more important.** SOFT
Inns, temples, markets and the like are visibly larger or otherwise distinguished from
anonymous housing.
*Check:* mean named-POI footprint area ≥ 1.4× mean anonymous-building area.

---

## 3. Streets

**S1 — The street network is always legible.** HARD
The plan of the town is readable at a glance. Buildings never bury it.
*Check:* ≥ 70% of road area is unobscured by building footprints, and every road segment
retains a visibly unobstructed run.

**S2 — Roads are drawn as worn tracks.** HARD
Two thin wobbled edge lines with sparse cross-ticks and a lighter bed between them, not a
solid uniform ribbon.
*Check:* road edges present as two distinct strokes with a measurably different fill between
them.

**S3 — Roads contrast with the ground they cross.** HARD
A pale road on pale ground is not a road. This is the defect that made every street invisible.
*Check:* luminance difference between road-edge ink and adjacent ground ≥ 25%.

**S4 — The network is connected.** HARD
Every street reaches the rest of the network; no orphan segments floating in open ground.
*Check:* the road graph forms a single connected component, ignoring runs shorter than
`streetWidth`.

**S5 — Streets have a hierarchy.** SOFT
Primary streets are wider than the lanes and alleys branching off them.
*Check:* at least two distinct road widths are present, the widest ≥ 1.5× the narrowest.

---

## 4. Water and terrain fit

**W1 — The settlement sits on land.** HARD
No part of a town's ground, wall, street or building falls on open water.
*Check:* zero building or road samples below sea level; town ground coverage over water is
zero.

**W2 — The settlement's edge follows the real shoreline.** HARD
Where a town meets water, its boundary is the coast, not a circle drawn through it.
*Check:* along coastal arcs, the boundary tracks the sea-level contour within a tolerance of
`0.05 × R`.

**W3 — A site must be able to hold its tier.** HARD
A city is not placed where only a hamlet fits.
*Check:* land fraction within the tier's footprint ≥ its threshold (city 0.70, town 0.55).

**W4 — Rivers cross towns properly.** HARD
A river running through a settlement stays visible, is not paved over, and is bridged
wherever a street crosses it.
*Check:* river pixels inside the boundary are not overdrawn by ground fill; each
street × river intersection has a bridge; no building sits in the channel.

**W5 — One river, not a delta of threads.** SOFT
At most a main river and one tributary. A tangle of minor streams is a simulation artefact,
not cartography.
*Check:* ≤ 2 river chains rendered inside the boundary.

---

## 5. Vegetation

**V1 — Trees are canopy clusters.** HARD
Rounded, overlapping lobes with a dark edge and a lit highlight — never flat triangles or
single blobs.
*Check:* each tree stamp has ≥ 3 lobes, an outline, and a highlight offset consistent with
B3's light direction.

**V2 — Woodland has an irregular edge.** SOFT
Forest boundaries wander; they do not stop on a clean geometric line.
*Check:* forest-boundary fractal dimension above threshold.

---

## 6. Labels

**L1 — Every label is readable over its background.** HARD
Serif type with a halo, so it stays legible over busy hachure.
*Check:* a halo of ≥ 2px is present, and text-to-immediate-background contrast ≥ 4.5:1.

**L2 — Labels never collide.** HARD
*Check:* no two label bounding boxes intersect.

**L3 — Labels stay inside the map.** HARD
No name is clipped by the canvas edge.
*Check:* every label box is fully within bounds, with a ≥ 4px margin.

**L4 — A label is attached to its subject.** SOFT
It either touches the thing it names or is joined to it by a leader line ending in a dot.
*Check:* label centre within `1.5 × labelHeight` of its subject, or a leader line is drawn.

**L5 — No two labels on a map say the same thing.** HARD
A reader given two buildings both called "Guard Post" cannot use either name. Where a tier
plans more than one of a kind, each instance is distinguished by where it is.
*Check:* label texts are unique across the map.
*Found by:* an audit reporting a collision between "Guard Post" and "Guard Post" — the
overlap was the bug being looked for, the duplicate name was a second one sitting behind it.

---

## 7. Composition

**C1 — The subject is framed.** HARD
The settlement is substantially within the canvas, not pinned against an edge or running off
it.
*Check:* ≥ 92% of the settlement's drawn extent is inside the canvas, and its centroid lies
within the middle 60% of the frame.

**C2 — The map is not empty.** SOFT
A town tier delivers a settlement of a believable size for that tier.
*Check:* building count within the expected band per tier (village 6–20, town 25–70,
city 60–160).

**C3 — Surroundings are shown.** SOFT
The settlement sits in visible countryside, not on a blank field: roads carry on out of
frame, worked fields lie against the built-up edge, woodland fills the ground between.
*Check:* ≥ 15% of the 24px tiles whose centres fall outside the town boundary carry local
pixel contrast (i.e. have something drawn on them).

*Caveat, and it matters.* This check counts **ink, not composition**. The first
implementation of the countryside passed it 12/12 while rendering the fields as saturated
green rectangles radiating off the boundary — legibly worse than the blank paper it
replaced, and passing comfortably. The measure is a floor against emptiness, not evidence
that the surroundings look right; that judgement still needs a contact sheet or the design
agent. Do not read a green C3 as "the countryside is good".

---

## 8. Colour

**K1 — Themes stay internally consistent.** HARD
All colour comes from the active theme's palette; nothing is hard-coded.
*Check:* sampled colours map to the active palette within tolerance.

**K2 — Buildings read against the ground.** HARD
*Check:* mean building-roof to adjacent-ground luminance contrast ≥ 20%.

**K3 — No pure black or pure white.** SOFT
Inks and highlights are tinted, as on painted maps.
*Check:* no significant pixel mass at luminance < 4% or > 97%, outside deliberate paper white.

---

## Open questions for review

1. **C2's building-count bands** are a first guess. If a village should feel smaller or a city
   denser, this is the number to change.
2. **S1's 70% threshold** decides how densely a town may build before streets start to
   disappear. Higher means airier towns.
3. **W5** caps rivers at two. If braided rivers are wanted somewhere, this becomes conditional
   on biome.
4. **G1's coverage band** is the difference between a sparse sketch and a dense engraving.
   Worth tuning against a reference side by side.
