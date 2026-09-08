// GM-facing reference text for a landmark site -- read-aloud opener,
// notable features, an optional hazard, and one treasure/one encounter
// hook. Same boundary lib/campaign-themes.js's own header comment already
// draws for this codebase: a deterministic, client-side table (instant, no
// infrastructure, same seed -> same text), NOT the LLM-backed Ollama
// generate-draft pipeline views/new-note.js/views/campaign.js use for
// user-authored notes -- bridging into that would be a real scope jump
// (Worker route + security review), not attempted here. Variety comes from
// combinatorics (template fill-ins x feature picks x hazard/treasure/
// encounter rolls), not a single canned string per type. Tone matches
// campaign-themes.js's own: evocative but grounded, one or two clauses,
// zero mechanics/stat blocks -- flavor text a GM reads or paraphrases, not
// rules content.

// One opener template per landmark type with small fill-in word banks --
// `{a}`/`{b}` are replaced from that type's own bank, so the same template
// reads differently seed to seed without needing dozens of hand-written
// full sentences.
const READ_ALOUD_TEMPLATES = {
  leyLineNexus: {
    template: 'The air here hums with a low, {a} vibration -- threads of pale light drift along unseen lines in the stone, {b} toward somewhere ahead.',
    banks: {
      a: ['constant', 'uneven', 'rising and falling', 'almost musical'],
      b: ['converging', 'pulsing', 'gathering', 'bending'],
    },
  },
  astralScar: {
    template: 'The world feels {a} here, like a page read one line out of order -- {b} light seeps from a wound in the air that never quite heals.',
    banks: {
      a: ['thin', 'wrong', 'slightly delayed', 'subtly doubled'],
      b: ['violet-black', 'colorless', 'cold, flickering', 'starlit'],
    },
  },
  giantsGarden: {
    template: 'Growth here is {a} on a scale no ordinary hand tended -- vines thick as ships\' rigging climb {b} stonework built for something much larger.',
    banks: {
      a: ['riotous', 'ancient', 'deliberate', 'untouched for a lifetime'],
      b: ['half-swallowed', 'moss-crowned', 'cracked but standing', 'deliberately shaped'],
    },
  },
  sunkenRuins: {
    template: 'Salt and standing water have had {a} years here -- {b} stonework rises just far enough above the waterline to be worth the wading.',
    banks: {
      a: ['centuries', 'generations', 'longer than anyone living remembers', 'more than one lifetime'],
      b: ['barnacle-crusted', 'green-black', 'slick, tide-worn', 'silt-choked'],
    },
  },
};

const NOTABLE_FEATURES = {
  leyLineNexus: [
    'A floor inlay of concentric rings, worn smooth except where the lines still glow.',
    'Faint chanting, always just at the edge of hearing, with no visible source.',
    'Metal objects here point along the lines rather than north.',
    'Motes of light drift upward from cracks in the floor and wink out near the ceiling.',
    'A single unbroken circle of standing stones, each one warm to the touch.',
    'Time sense grows unreliable the closer one gets to the heart of the site.',
  ],
  astralScar: [
    'Gravity is faintly, inconsistently wrong within a few paces of the rift.',
    'Sound arrives a half-beat late, as if the air itself is behind.',
    'Small objects dropped nearby sometimes land somewhere else in the room.',
    'A patch of stars is visible through the rift, in a sky that does not match outside.',
    'Anything that touches the rift\'s edge briefly forgets what it was doing.',
    'The scar\'s light casts no shadows, from any angle.',
  ],
  giantsGarden: [
    'Handholds and steps are spaced for a stride twice human length.',
    'A half-buried stone chair, sized to match, still bears the wear of use.',
    'Fruit here grows to an unsettling, oversized ripeness and never seems to rot.',
    'Deep, healed gouges in the stonework match nothing smaller than a giant\'s grip.',
    'Birdsong stops abruptly at the garden\'s old boundary wall.',
    'A trellis of ironwood, still flowering, older than any record of who planted it.',
  ],
  sunkenRuins: [
    'Waterlines on the walls mark at least three different sea levels over the ages.',
    'Fish dart through window-frames that once looked out on dry streets.',
    'A ship\'s bell, still legible, hangs half-submerged and slowly turning.',
    'Faded murals survive only above the current tide line.',
    'The wreck timbers are foreign to the region -- this was never a local vessel.',
    'A rope ladder, too new to be original, has been left by someone recent.',
  ],
};

const HAZARD_TABLE = {
  leyLineNexus: [
    'Lingering too long near the lines causes a creeping, disorienting fatigue.',
    'The lines occasionally arc between metal objects (and metal-armored visitors).',
    'A miscast or overloud spell here risks drawing the whole site\'s attention.',
  ],
  astralScar: [
    'Standing too close to the rift risks a brief, involuntary translocation.',
    'The scar occasionally exhales a pulse of disorienting, silent light.',
    'Something on the far side of the rift seems to be aware it is being watched.',
  ],
  giantsGarden: [
    'Sap from the largest vines is mildly caustic on bare skin.',
    'Something large enough to leave those handholds may not be gone for good.',
    'Overripe fruit underfoot conceals genuinely unstable, rotted flooring beneath.',
  ],
  sunkenRuins: [
    'Waterlogged floors and stairs give way without much warning.',
    'The deeper chambers flood fully at certain tides.',
    'Whatever nests in the flooded sections has had a very long time undisturbed.',
  ],
};

const TREASURE_HOOK_TABLE = {
  leyLineNexus: [
    'A focus-stone at the heart of the site still holds a fraction of a stored spell.',
    'Pilgrims left offerings along the lines for longer than anyone can date.',
    'The site\'s attunement circle could be worth more to a mage than any coin found here.',
  ],
  astralScar: [
    'Fragments of something not from this world litter the ground near the rift.',
    'A creature\'s hoard, displaced whole from elsewhere, sits incongruously in one chamber.',
    'Whatever fell through the rift first is still worth finding, if it can be found.',
  ],
  giantsGarden: [
    'A giant\'s cache, sized to match, is easy to miss and hard to carry out.',
    'Seeds from the garden\'s oldest growth would be prized by any herbalist.',
    'Something valuable was clearly left here on purpose, not simply lost.',
  ],
  sunkenRuins: [
    'The wreck\'s hold was never fully salvaged before the water claimed it.',
    'A sealed strongbox has kept the sea out for longer than seems possible.',
    'Whatever this place traded in before it sank is still down here, somewhere.',
  ],
};

const ENCOUNTER_HOOK_TABLE = {
  leyLineNexus: [
    'Something that feeds on the lines\' power has taken up residence at the heart of the site.',
    'A rival attempting to attune to the nexus is already here when the party arrives.',
    'The lines have drawn a would-be pilgrim who does not welcome company.',
  ],
  astralScar: [
    'Something crossed through the rift recently, and it has not gone far.',
    'A scholar obsessed with the scar has been camped here for longer than is safe.',
    'The rift occasionally spits out something that very much wants to go home.',
  ],
  giantsGarden: [
    'The garden\'s original tender, or something that remembers being one, still visits.',
    'Something has made a den among the oversized roots and does not appreciate visitors.',
    'A creature the giant once kept is still, loyally, guarding the grounds.',
  ],
  sunkenRuins: [
    'Something has made a lair in the flooded lower chambers.',
    'A salvage crew got here first, and they are not eager to share.',
    'The ruins\' original occupants left guardians that never learned the place was abandoned.',
  ],
};

function fillTemplate(entry, rng) {
  let text = entry.template;
  for (const slot in entry.banks) {
    const options = entry.banks[slot];
    const pick = options[Math.floor(rng() * options.length)];
    text = text.split(`{${slot}}`).join(pick);
  }
  return text;
}

// rng picks `count` distinct entries from `pool` without replacement --
// used for notable features so the same fragment never appears twice in
// one site's lore.
function pickWithoutReplacement(pool, count, rng) {
  const copy = pool.slice();
  const picked = [];
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}

function generateLandmarkLore(rng, typeKey) {
  const readAloud = fillTemplate(READ_ALOUD_TEMPLATES[typeKey] || READ_ALOUD_TEMPLATES.sunkenRuins, rng);
  const notableFeatures = pickWithoutReplacement(NOTABLE_FEATURES[typeKey] || [], 2 + Math.floor(rng() * 2), rng);
  const hazardPool = HAZARD_TABLE[typeKey] || [];
  const hazard = (rng() < 0.7 && hazardPool.length) ? hazardPool[Math.floor(rng() * hazardPool.length)] : null;
  const treasurePool = TREASURE_HOOK_TABLE[typeKey] || [];
  const treasureHook = treasurePool.length ? treasurePool[Math.floor(rng() * treasurePool.length)] : null;
  const encounterPool = ENCOUNTER_HOOK_TABLE[typeKey] || [];
  const encounterHook = encounterPool.length ? encounterPool[Math.floor(rng() * encounterPool.length)] : null;
  return { readAloud, notableFeatures, hazard, treasureHook, encounterHook };
}
