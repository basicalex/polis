// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared EN/HR strings for the `/demo/*` role surfaces.
 *
 * Owned by the demo foundation slice. Other slices import from this module and never edit it.
 *
 * Every label here is product chrome, not fixture material. The reviewed status labels come
 * straight from the DESIGN.md meaning table and must not be paraphrased.
 *
 * @typedef {'en' | 'hr'} DemoLang
 * @typedef {{ en: string, hr: string }} LocalizedText
 * @typedef {string | LocalizedText} DisplayText
 */

/** Languages the demo surfaces render. */
export const DEMO_LANGS = /** @type {readonly DemoLang[]} */ (Object.freeze(['en', 'hr']));

/** Report categories the demo store accepts. */
export const DEMO_CATEGORIES = Object.freeze(['roads', 'water', 'waste', 'lighting', 'other']);

/**
 * Read a display field in one language.
 *
 * Seeded fixtures and store-generated event text carry `{ en, hr }`; text a visitor typed into a
 * demo form is a plain string in whichever language they used. Both forms pass through here.
 *
 * @param {DisplayText | null | undefined} value
 * @param {DemoLang} lang
 * @returns {string}
 */
export function resolveText(value, lang) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const key = lang === 'hr' ? 'hr' : 'en';
  return value[key] ?? value.en ?? '';
}

/** The five demo surfaces, in the order the role strip shows them. */
export const demoSurfaces = Object.freeze([
  Object.freeze({
    id: 'citizen',
    href: '/demo/citizen',
    label: Object.freeze({ en: 'Citizen', hr: 'Građanin' }),
  }),
  Object.freeze({
    id: 'official',
    href: '/demo/official',
    label: Object.freeze({ en: 'Official', hr: 'Dužnosnik' }),
  }),
  Object.freeze({
    id: 'review',
    href: '/demo/review',
    label: Object.freeze({ en: 'Review', hr: 'Provjera' }),
  }),
  Object.freeze({
    id: 'record',
    href: '/demo/record',
    label: Object.freeze({ en: 'Record', hr: 'Zapis' }),
  }),
  Object.freeze({
    id: 'embed',
    href: '/demo/embed',
    label: Object.freeze({ en: 'Embed', hr: 'Ugradnja' }),
  }),
]);

/** Full role names, for page headings and the role label beside the banner. */
export const roleNames = Object.freeze({
  citizen: Object.freeze({ en: 'Citizen', hr: 'Građanin' }),
  official: Object.freeze({ en: 'Public official', hr: 'Dužnosnik' }),
  review: Object.freeze({ en: 'Independent reviewer', hr: 'Neovisni provjeritelj' }),
  record: Object.freeze({ en: 'Public record', hr: 'Javni zapis' }),
  embed: Object.freeze({ en: 'Embedded interface', hr: 'Ugrađeno sučelje' }),
});

/**
 * Reviewed meaning-model labels. Exact strings from the DESIGN.md meaning table.
 */
export const statusLabels = Object.freeze({
  public: Object.freeze({ en: 'PUBLIC', hr: 'JAVNO' }),
  privateRestricted: Object.freeze({
    en: 'PRIVATE / RESTRICTED',
    hr: 'PRIVATNO / OGRANIČENO',
  }),
  pendingReview: Object.freeze({ en: 'PENDING REVIEW', hr: 'ČEKA NEOVISNU PROVJERU' }),
  awaitingReview: Object.freeze({
    en: 'AWAITING INDEPENDENT REVIEW',
    hr: 'ČEKA NEOVISNU PROVJERU',
  }),
  verifiedLocal: Object.freeze({ en: 'VERIFIED LOCALLY', hr: 'LOKALNO PROVJERENO' }),
  pilotTarget: Object.freeze({ en: 'PILOT TARGET', hr: 'CILJ PILOT-PROJEKTA' }),
  notLive: Object.freeze({ en: 'NOT LIVE', hr: 'NIJE AKTIVNO' }),
  demonstrationFixture: Object.freeze({
    en: 'DEMONSTRATION FIXTURE',
    hr: 'DEMONSTRACIJSKI PRIMJER',
  }),
  mismatch: Object.freeze({
    en: 'CHANGED BYTE — NO MATCH',
    hr: 'PROMIJENJEN BAJT — NEMA PODUDARANJA',
  }),
  notChecked: Object.freeze({ en: 'NOT CHECKED', hr: 'NIJE PROVJERENO' }),
});

/** Trace stage names, in trace order. */
export const stageLabels = Object.freeze({
  voice: Object.freeze({ en: 'Voice', hr: 'Glas' }),
  responsibility: Object.freeze({ en: 'Responsibility', hr: 'Odgovornost' }),
  response: Object.freeze({ en: 'Response', hr: 'Odgovor' }),
  check: Object.freeze({ en: 'Independent check', hr: 'Neovisna provjera' }),
  receipt: Object.freeze({ en: 'Public receipt', hr: 'Javna potvrda' }),
});

/**
 * Workflow status of a demo record. These describe where the record stands, not whether a claim
 * is true, and they never replace the meaning-model label beside a gated claim.
 */
export const recordStatusLabels = Object.freeze({
  open: Object.freeze({ en: 'Open — no responsible office', hr: 'Otvoreno — bez nadležnog ureda' }),
  assigned: Object.freeze({ en: 'Responsibility assigned', hr: 'Odgovornost dodijeljena' }),
  'commitment-pending-review': Object.freeze({
    en: 'Commitment pending review',
    hr: 'Obveza čeka provjeru',
  }),
  returned: Object.freeze({ en: 'Returned by review', hr: 'Vraćeno s provjere' }),
  published: Object.freeze({ en: 'Published receipt', hr: 'Objavljena potvrda' }),
});

/**
 * Short stamp words for the workflow status, one set for every demo surface.
 * `recordStatusLabels` keeps the sentence form for prose; stamps use these.
 */
export const stampLabels = Object.freeze({
  open: Object.freeze({ en: 'NEW', hr: 'NOVO' }),
  assigned: Object.freeze({ en: 'ASSIGNED', hr: 'DODIJELJENO' }),
  'commitment-pending-review': Object.freeze({
    en: 'PENDING REVIEW',
    hr: 'ČEKA NEOVISNU PROVJERU',
  }),
  returned: Object.freeze({ en: 'RETURNED', hr: 'VRAĆENO' }),
  accepted: Object.freeze({ en: 'ACCEPTED', hr: 'PRIHVAĆENO' }),
  published: Object.freeze({ en: 'PUBLISHED', hr: 'OBJAVLJENO' }),
});

/** Where a record came from. Visitor input stays distinct from seeded fixtures. */
export const originLabels = Object.freeze({
  seed: Object.freeze({ en: 'Seeded fixture', hr: 'Početni primjer' }),
  app: Object.freeze({ en: 'Your demo input', hr: 'Vaš demo unos' }),
  embed: Object.freeze({ en: 'Your demo input (embedded form)', hr: 'Vaš demo unos (ugrađeni obrazac)' }),
});

/** Category display names. */
export const categoryLabels = Object.freeze({
  roads: Object.freeze({ en: 'Roads', hr: 'Ceste' }),
  water: Object.freeze({ en: 'Water', hr: 'Voda' }),
  waste: Object.freeze({ en: 'Waste', hr: 'Otpad' }),
  lighting: Object.freeze({ en: 'Street lighting', hr: 'Javna rasvjeta' }),
  other: Object.freeze({ en: 'Other', hr: 'Ostalo' }),
});

/** Actors the store names when it appends an event on the visitor's behalf. */
export const demoActors = Object.freeze({
  resident: Object.freeze({ en: 'Resident (demo input)', hr: 'Stanovnik (demo unos)' }),
  publicRecord: Object.freeze({ en: 'Public record', hr: 'Javni zapis' }),
});

/** Event actions the store writes. Kept here so both languages stay in one place. */
export const demoEventActions = Object.freeze({
  reportFiled: Object.freeze({ en: 'Report filed', hr: 'Prijava podnesena' }),
  responsibilityAssigned: Object.freeze({
    en: 'Responsible office assigned',
    hr: 'Dodijeljen nadležni ured',
  }),
  commitmentFiled: Object.freeze({
    en: 'Commitment filed, pending independent review',
    hr: 'Obveza podnesena, čeka neovisnu provjeru',
  }),
  reviewAccepted: Object.freeze({
    en: 'Independent review accepted the commitment',
    hr: 'Neovisna provjera prihvatila je obvezu',
  }),
  reviewReturned: Object.freeze({
    en: 'Independent review returned the commitment',
    hr: 'Neovisna provjera vratila je obvezu',
  }),
  published: Object.freeze({
    en: 'Publication followed independent review',
    hr: 'Objava je uslijedila nakon neovisne provjere',
  }),
});

/**
 * The page-level demonstration boundary: one sentence, stated once per demo page as the thin
 * line under the app bar. It merges what used to be `demoBanner` plus `demoLocalNote`.
 */
export const demoBoundary = Object.freeze({
  en: 'Demonstration — fictional data, stored only in this browser.',
  hr: 'Demonstracija — izmišljeni podaci, pohranjeni samo u ovom pregledniku.',
});

/**
 * The quiet institution line under a demo page title.
 * Grad Primjer is the fictional municipality; it never names a real one.
 */
export const institutionAnchor = Object.freeze({
  en: 'Grad Primjer — public record',
  hr: 'Grad Primjer — javna evidencija',
});

/**
 * @deprecated Use `demoBoundary`. Kept so pages that still import it keep building.
 */
export const demoBanner = Object.freeze({
  en: 'Demonstration with fictional data — not a live service.',
  hr: 'Demonstracija s izmišljenim podacima — nije aktivna usluga.',
});

/**
 * @deprecated Merged into `demoBoundary`. Kept so pages that still import it keep building.
 */
export const demoLocalNote = Object.freeze({
  en: 'Everything you file here stays in this browser.',
  hr: 'Sve što ovdje podnesete ostaje u ovom pregledniku.',
});

/** Link text beside the banner, pointing at the transparency page. */
export const demoBannerDetails = Object.freeze({ en: 'Details', hr: 'Pojedinosti' });

/** Reset control copy. The confirm text is what the visitor reads before losing their input. */
export const resetDemoCopy = Object.freeze({
  label: Object.freeze({ en: 'Reset demo', hr: 'Vrati demo na početak' }),
  confirm: Object.freeze({
    en: 'Reset the demo? Records you filed in this browser are deleted and the seeded fixtures come back.',
    hr: 'Vratiti demo na početak? Zapisi koje ste podnijeli u ovom pregledniku brišu se i vraćaju se početni primjeri.',
  }),
  done: Object.freeze({
    en: 'Demo reset. The seeded fixtures are back.',
    hr: 'Demo je vraćen na početak. Početni primjeri su vraćeni.',
  }),
});

/**
 * Language control copy.
 *
 * `short` is what the two-letter segments read; `name` is each segment's accessible name, written
 * in the language it selects. `label` is the old single-button copy and stays for importers.
 */
export const languageToggle = Object.freeze({
  short: Object.freeze({ en: 'EN', hr: 'HR' }),
  name: Object.freeze({ en: 'English', hr: 'Hrvatski' }),
  groupLabel: Object.freeze({ en: 'Language', hr: 'Jezik' }),
  /** @deprecated The EN | HR segments replaced the single toggle button. */
  label: Object.freeze({ en: 'Hrvatski', hr: 'English' }),
});

/** Shared chrome wording for the demo surfaces. */
export const demoChrome = Object.freeze({
  roleStrip: Object.freeze({ en: 'Demo roles', hr: 'Demo uloge' }),
  home: Object.freeze({ en: 'Polis home', hr: 'Naslovnica Polisa' }),
  boundaryLabel: Object.freeze({
    en: 'Demonstration boundary',
    hr: 'Granica demonstracije',
  }),
  skipToDemo: Object.freeze({ en: 'Skip to the demo surface', hr: 'Preskoči na demo prikaz' }),
  /** @deprecated The role switcher marks the current surface; no separate "you are here" tail. */
  currentSurface: Object.freeze({ en: 'here', hr: 'ovdje' }),
});
