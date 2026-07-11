// ============================================================================
// The Covenant — the cross-game meta-layer shared by all five natures.
//
// The Light-Bringer ships five games behind one class-select hub, and until
// now they were perfect strangers: five legacy keys, five currencies, no
// reason to walk more than one road. The Covenant is the connective tissue —
// a single shared localStorage key that every game writes a small "echo" of
// its run-ends into, and reads two things back out of:
//
//   1. BOONS — each nature grows a little stronger for every victory won as
//      the OTHER four natures ("the other natures lend their strength").
//      Each game interprets its boon in its own idiom (the Vigil hardens the
//      carrier's flame, the March starts with deeper soul-stores, ...);
//      this module only supplies the shared strength scale, capped small so
//      no game's balance is ever carried by another.
//
//   2. THE FIVEFOLD CROWN — win at least once as each of the five natures to
//      forge a crown. Each cycle tracks which natures have contributed a
//      victory; when all five have, the crown is forged: the lifetime crown
//      count rises, the cycle resets, and a BOUNTY of every game's own
//      currency is banked, claimed the next time each game opens its picker.
//
// Discipline (mirrors the games' legacy keys): one key, defaulted on load
// with no version bump, every read/write behind try/catch so a stubbed or
// absent localStorage can never crash a game, and run-end folds happen
// exactly once per genuine end (the games call recordEcho beside their own
// recordClear/recordFall pair). Pure data + localStorage — this module never
// touches the DOM, so the headless tests can drive it directly.
//
// This file is deliberately a shared ES module (the one exception to "the
// five games are isolated"): all five games and the hub import it, which is
// the point — it is the connective tissue.
// ============================================================================

export const COVENANT_KEY = "lightbringer.covenant.v1";

/** The five natures, in the hub's canonical order. Ids match the hub's
 *  `data-class` attributes so the two vocabularies never drift. */
export const NATURES = ["vigil", "necro", "watcher", "werewolf", "bomber"] as const;
export type NatureId = (typeof NATURES)[number];

/** Display names + emblems, shared by the hub panel and the share card. */
export const NATURE_NAMES: Record<NatureId, string> = {
  vigil: "The Burning Vigil",
  necro: "The Necromancer's March",
  watcher: "The Watcher at the Threshold",
  werewolf: "The Moon's Hunger",
  bomber: "The Iron Rain",
};
/** Each nature's boon idiom, as prose for the hub panel. The numbers live as
 *  tuning constants in each game (COVENANT_*_PER_BOON etc.); keep these lines
 *  in step when those dials move. All are capped at BOON_CAP victories. */
export const BOON_HINTS: Record<NatureId, string> = {
  vigil: "+2 max HP per victory won elsewhere",
  necro: "+1 starting soul per 3 victories won elsewhere",
  watcher: "+2 max sanity per victory won elsewhere",
  werewolf: "+3% starting fury per victory won elsewhere",
  bomber: "+2 airframe HP per victory won elsewhere",
};

export const NATURE_MARKS: Record<NatureId, string> = {
  vigil: "\u{1F525}",    // 🔥
  necro: "\u{1F480}",    // 💀
  watcher: "\u{1F441}\u{FE0F}", // 👁️
  werewolf: "\u{1F43A}", // 🐺
  bomber: "\u{2708}\u{FE0F}",   // ✈️
};

/** One nature's lifetime imprint on the covenant. */
export interface NatureEcho {
  runs: number;      // run-ends folded in (win or fall)
  victories: number; // wins only — the boon and crown fuel
  bestScore: number; // best single-run score ever, any level
}

export interface CrownState {
  /** Natures that have contributed a victory to the CURRENT cycle. */
  done: NatureId[];
  /** Fivefold crowns forged, lifetime. */
  crowns: number;
  /** Unclaimed per-game currency bounties from forged crowns. */
  bounty: Record<NatureId, number>;
}

export interface Covenant {
  echoes: Record<NatureId, NatureEcho>;
  crown: CrownState;
}

// ---------- Tuning ----------

/** Boon strength = min(victories won as the OTHER four natures, this cap).
 *  Small on purpose: a fully-forged covenant is a head start, not a carry. */
export const BOON_CAP = 10;

/** Currency banked in EVERY game when a fivefold crown is forged (embers /
 *  relics / lore / moonstones / medals — each game folds its own share in). */
export const CROWN_BOUNTY = 80;

// ---------- Persistence ----------

function emptyEcho(): NatureEcho {
  return { runs: 0, victories: 0, bestScore: 0 };
}

export function emptyCovenant(): Covenant {
  const echoes = {} as Record<NatureId, NatureEcho>;
  const bounty = {} as Record<NatureId, number>;
  for (const n of NATURES) { echoes[n] = emptyEcho(); bounty[n] = 0; }
  return { echoes, crown: { done: [], crowns: 0, bounty } };
}

function asCount(v: unknown): number {
  return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Load the covenant, defaulting every field (no version bump, ever) and
 *  validating so a hand-edited or future-shaped blob can never dangle into a
 *  crash. Safe under a stubbed localStorage (the headless tests). */
export function loadCovenant(): Covenant {
  try {
    const raw = localStorage.getItem(COVENANT_KEY);
    if (!raw) return emptyCovenant();
    const p = JSON.parse(raw) as Partial<Covenant>;
    const c = emptyCovenant();
    for (const n of NATURES) {
      const e = p.echoes && (p.echoes as Record<string, Partial<NatureEcho>>)[n];
      if (e && typeof e === "object") {
        c.echoes[n] = {
          runs: asCount(e.runs),
          victories: asCount(e.victories),
          bestScore: asCount(e.bestScore),
        };
      }
    }
    const cr = p.crown;
    if (cr && typeof cr === "object") {
      c.crown.crowns = asCount(cr.crowns);
      if (Array.isArray(cr.done)) {
        c.crown.done = [...new Set(cr.done)].filter(
          (n): n is NatureId => (NATURES as readonly string[]).includes(n as string),
        );
      }
      if (cr.bounty && typeof cr.bounty === "object") {
        for (const n of NATURES) c.crown.bounty[n] = asCount((cr.bounty as Record<string, unknown>)[n]);
      }
    }
    return c;
  } catch { return emptyCovenant(); }
}

export function saveCovenant(c: Covenant): void {
  try { localStorage.setItem(COVENANT_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ---------- Run-end fold (write-once-per-end, like the games' legacies) ----------

export interface EchoResult {
  covenant: Covenant;
  /** This victory was the nature's first contribution to the current cycle. */
  firstOfCycle: boolean;
  /** This victory completed the cycle: a fivefold crown was forged. */
  crowned: boolean;
}

/** Fold one genuine run-end into the covenant. Games call this exactly once
 *  per end (win or fall), beside their own recordClear/recordFall pair. A
 *  victory in a nature not yet counted this cycle advances the Fivefold
 *  Crown; the fifth distinct nature forges it — crowns++, the cycle resets,
 *  and every game's bounty is banked. */
export function recordEcho(nature: NatureId, won: boolean, score = 0): EchoResult {
  const c = loadCovenant();
  const e = c.echoes[nature];
  e.runs++;
  let firstOfCycle = false;
  let crowned = false;
  if (won) {
    e.victories++;
    if (score > e.bestScore) e.bestScore = Math.floor(score);
    if (!c.crown.done.includes(nature)) {
      c.crown.done.push(nature);
      firstOfCycle = true;
      if (c.crown.done.length >= NATURES.length) {
        crowned = true;
        c.crown.crowns++;
        c.crown.done = [];
        for (const n of NATURES) c.crown.bounty[n] += CROWN_BOUNTY;
      }
    }
  }
  saveCovenant(c);
  return { covenant: c, firstOfCycle, crowned };
}

// ---------- Boons (read at each game's buildArena) ----------

/** Victories won as every nature EXCEPT this one — the boon's fuel. */
export function otherVictories(c: Covenant, nature: NatureId): number {
  let v = 0;
  for (const n of NATURES) if (n !== nature) v += c.echoes[n].victories;
  return v;
}

/** The shared boon scale: 0 (no covenant) .. BOON_CAP. Each game multiplies
 *  this into its own idiom (HP, souls, sanity, fury, plating). */
export function boonStrength(c: Covenant, nature: NatureId): number {
  return Math.min(otherVictories(c, nature), BOON_CAP);
}

// ---------- Bounty claim (at each game's picker, write-once) ----------

/** Take this nature's unclaimed crown bounty (0 if none) and zero it. The
 *  caller folds the amount into its own currency immediately — claiming and
 *  folding together form the once-only transfer. */
export function claimBounty(nature: NatureId): number {
  const c = loadCovenant();
  const due = c.crown.bounty[nature];
  if (due <= 0) return 0;
  c.crown.bounty[nature] = 0;
  saveCovenant(c);
  return due;
}

// ---------- Shared prose (pickers + hub) ----------

/** One-line covenant status for a game's picker: what the other natures have
 *  lent, and how the crown stands. Empty string while the covenant is blank
 *  (a player who never left this game never sees the feature). */
export function covenantLine(c: Covenant, nature: NatureId, boonText: string): string {
  const v = otherVictories(c, nature);
  const parts: string[] = [];
  if (v > 0) parts.push(`${boonText} — the other natures lend their strength (${v} victor${v === 1 ? "y" : "ies"} elsewhere).`);
  const done = c.crown.done.length;
  if (c.crown.crowns > 0) parts.push(`Fivefold crowns forged: ${c.crown.crowns}.`);
  if (done > 0 && done < NATURES.length) parts.push(`The next crown stands at ${done}/5 natures.`);
  return parts.join(" ");
}
