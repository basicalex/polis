/**
 * Seed fixtures for the `/demo/*` surfaces.
 *
 * Every record, office, role, person, date, and outcome below is frozen synthetic test material
 * set in the fictional municipality Grad Primjer. Nothing here describes a real resident, case,
 * office, partner, deployment, authorization, or result. No real municipality — Vrsar included —
 * appears in this file.
 *
 * Display fields carry `{ en, hr }` so both product languages read the same record. Identifiers,
 * ISO dates, categories, stages, statuses, decisions, and event kinds stay plain data.
 *
 * `createdAt` and every event `at` value is a fixed ISO string. Nothing here is computed at load.
 *
 * @typedef {import('./demo-strings.mjs').LocalizedText} LocalizedText
 * @typedef {import('./demo-strings.mjs').DisplayText} DisplayText
 *
 * @typedef {object} DemoEvent
 * @property {number} seq
 * @property {'voice' | 'responsibility' | 'response' | 'check' | 'receipt'} stage
 * @property {DisplayText} actor
 * @property {DisplayText} action
 * @property {string} at ISO 8601
 * @property {'appended' | 'proposed'} kind
 * @property {DisplayText} [note]
 *
 * @typedef {object} DemoRecord
 * @property {string} id
 * @property {'seed' | 'app' | 'embed'} origin
 * @property {DisplayText} subject
 * @property {DisplayText} narrative
 * @property {'roads' | 'water' | 'waste' | 'lighting' | 'other'} category
 * @property {string} createdAt ISO 8601
 * @property {'voice' | 'responsibility' | 'response' | 'check' | 'receipt'} stage
 * @property {'open' | 'assigned' | 'commitment-pending-review' | 'returned' | 'published'} status
 * @property {{ office: DisplayText, role: DisplayText } | null} responsibility
 * @property {{ text: DisplayText, due: string, filedBy: DisplayText,
 *   reviewStatus: 'pending' | 'accepted' | 'returned' } | null} commitment
 * @property {{ decision: 'accepted' | 'returned', note: DisplayText, reviewer: DisplayText } | null} review
 * @property {DemoEvent[]} events
 */

/** @param {unknown} value */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

const utilitiesOffice = {
  en: 'Grad Primjer — public utilities office (fictional)',
  hr: 'Grad Primjer — ured za komunalne poslove (izmišljen)',
};

const utilitiesRole = {
  en: 'Head of public utilities (fictional)',
  hr: 'Pročelnik komunalnih poslova (izmišljen)',
};

const waterOffice = {
  en: 'Grad Primjer — water supply office (fictional)',
  hr: 'Grad Primjer — ured za vodoopskrbu (izmišljen)',
};

const waterRole = {
  en: 'Head of water supply (fictional)',
  hr: 'Pročelnik vodoopskrbe (izmišljen)',
};

const reviewer = {
  en: 'Independent reviewer (fictional)',
  hr: 'Neovisni provjeritelj (izmišljen)',
};

const resident = { en: 'Resident (fictional)', hr: 'Stanovnik (izmišljen)' };

const publicRecord = { en: 'Public record', hr: 'Javni zapis' };

/** @type {DemoRecord[]} */
const records = [
  {
    id: 'POLIS-D-0001',
    origin: 'seed',
    subject: {
      en: 'Three streetlights dark on Trg Primjera',
      hr: 'Tri ulične svjetiljke ne rade na Trgu Primjera',
    },
    narrative: {
      en: 'The lamps on the square by the school have been out since mid-February. The crossing is unlit after 17:00 and children walk it every weekday.',
      hr: 'Svjetiljke na trgu kraj škole ne rade od sredine veljače. Prijelaz je neosvijetljen nakon 17:00, a djeca njime prolaze svaki radni dan.',
    },
    category: 'lighting',
    createdAt: '2026-02-18T08:20:00Z',
    stage: 'receipt',
    status: 'published',
    responsibility: { office: utilitiesOffice, role: utilitiesRole },
    commitment: {
      text: {
        en: 'Replace the three lamps on Trg Primjera and record the completion date on the public record.',
        hr: 'Zamijeniti tri svjetiljke na Trgu Primjera i datum dovršetka upisati u javni zapis.',
      },
      due: '2026-04-30',
      filedBy: utilitiesRole,
      reviewStatus: 'accepted',
    },
    review: {
      decision: 'accepted',
      note: {
        en: 'Work order and completion entry checked against the fixture registry. The filed commitment matches the scope it was gated on.',
        hr: 'Radni nalog i upis o dovršetku provjereni prema registru primjera. Podnesena obveza odgovara opsegu na kojem je propuštena kroz provjeru.',
      },
      reviewer,
    },
    events: [
      {
        seq: 1,
        stage: 'voice',
        actor: resident,
        action: { en: 'Report filed', hr: 'Prijava podnesena' },
        at: '2026-02-18T08:20:00Z',
        kind: 'appended',
      },
      {
        seq: 2,
        stage: 'responsibility',
        actor: utilitiesOffice,
        action: { en: 'Responsible office assigned', hr: 'Dodijeljen nadležni ured' },
        at: '2026-02-20T10:05:00Z',
        kind: 'appended',
      },
      {
        seq: 3,
        stage: 'response',
        actor: utilitiesRole,
        action: {
          en: 'Commitment filed, pending independent review',
          hr: 'Obveza podnesena, čeka neovisnu provjeru',
        },
        at: '2026-03-02T13:40:00Z',
        kind: 'appended',
      },
      {
        seq: 4,
        stage: 'check',
        actor: reviewer,
        action: {
          en: 'Independent review accepted the commitment',
          hr: 'Neovisna provjera prihvatila je obvezu',
        },
        at: '2026-03-11T09:15:00Z',
        kind: 'appended',
        note: {
          en: 'The reviewer is not the filing office. Evidence scope: work order and completion entry.',
          hr: 'Provjeritelj nije ured koji je podnio obvezu. Opseg dokaza: radni nalog i upis o dovršetku.',
        },
      },
      {
        seq: 5,
        stage: 'receipt',
        actor: publicRecord,
        action: {
          en: 'Publication followed independent review',
          hr: 'Objava je uslijedila nakon neovisne provjere',
        },
        at: '2026-03-11T09:17:00Z',
        kind: 'appended',
        note: {
          en: 'Published is a publication status. It does not claim the promise is fulfilled.',
          hr: '„Objavljeno” je status objave. Ne tvrdi da je obećanje ispunjeno.',
        },
      },
    ],
  },
  {
    id: 'POLIS-D-0002',
    origin: 'seed',
    subject: {
      en: 'Water pressure drops every morning in Ulica Primjera',
      hr: 'Tlak vode svako jutro pada u Ulici Primjera',
    },
    narrative: {
      en: 'Between 06:00 and 08:00 the upper floors of the street have almost no pressure. Neighbours report the same pattern on both sides of the street.',
      hr: 'Između 06:00 i 08:00 gornji katovi u ulici gotovo su bez tlaka. Susjedi prijavljuju isto s obje strane ulice.',
    },
    category: 'water',
    createdAt: '2026-04-06T07:05:00Z',
    stage: 'response',
    status: 'commitment-pending-review',
    responsibility: { office: waterOffice, role: waterRole },
    commitment: {
      text: {
        en: 'Measure morning pressure at three points in Ulica Primjera and publish the measurement dates and readings.',
        hr: 'Izmjeriti jutarnji tlak na tri točke u Ulici Primjera te objaviti datume mjerenja i očitanja.',
      },
      due: '2026-06-15',
      filedBy: waterRole,
      reviewStatus: 'pending',
    },
    review: null,
    events: [
      {
        seq: 1,
        stage: 'voice',
        actor: resident,
        action: { en: 'Report filed', hr: 'Prijava podnesena' },
        at: '2026-04-06T07:05:00Z',
        kind: 'appended',
      },
      {
        seq: 2,
        stage: 'responsibility',
        actor: waterOffice,
        action: { en: 'Responsible office assigned', hr: 'Dodijeljen nadležni ured' },
        at: '2026-04-08T11:30:00Z',
        kind: 'appended',
      },
      {
        seq: 3,
        stage: 'response',
        actor: waterRole,
        action: {
          en: 'Commitment filed, pending independent review',
          hr: 'Obveza podnesena, čeka neovisnu provjeru',
        },
        at: '2026-04-21T15:12:00Z',
        kind: 'proposed',
        note: {
          en: 'Proposed history. It is not published until a distinct independent review accepts it.',
          hr: 'Predložena povijest. Ne objavljuje se dok je zasebna neovisna provjera ne prihvati.',
        },
      },
    ],
  },
  {
    id: 'POLIS-D-0003',
    origin: 'seed',
    subject: {
      en: 'Dumped construction waste behind the sports hall',
      hr: 'Odbačeni građevinski otpad iza sportske dvorane',
    },
    narrative: {
      en: 'Someone left rubble and broken tiles on the path behind the sports hall. The pile has grown over two weeks and blocks half the path.',
      hr: 'Netko je ostavio šutu i razbijene pločice na stazi iza sportske dvorane. Hrpa raste dva tjedna i zaprječuje pola staze.',
    },
    category: 'waste',
    createdAt: '2026-05-12T16:48:00Z',
    stage: 'voice',
    status: 'open',
    responsibility: null,
    commitment: null,
    review: null,
    events: [
      {
        seq: 1,
        stage: 'voice',
        actor: resident,
        action: { en: 'Report filed', hr: 'Prijava podnesena' },
        at: '2026-05-12T16:48:00Z',
        kind: 'appended',
      },
    ],
  },
];

/** Frozen seed records. The store clones them; nothing mutates this array. */
export const seedRecords = /** @type {readonly DemoRecord[]} */ (deepFreeze(records));

/** Language the demo starts in before a visitor chooses one. */
export const seedLang = 'en';

/** Fixture identifier for the provenance line on demo surfaces. */
export const seedFixtureId = 'demo-grad-primjer-001';
