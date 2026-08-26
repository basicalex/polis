/**
 * App-owned content for the public Trace line release.
 *
 * Every record, actor, date, digest, and outcome in this module is frozen synthetic
 * test material. Nothing here describes a real resident, case, partner, deployment,
 * authorization, or result. This module contains no URL, host, or network reference.
 */

export type Lang = 'en' | 'hr';
export type Stage = 'voice' | 'responsibility' | 'response' | 'check' | 'receipt';
export type CapabilityState =
  | 'implemented-locally'
  | 'demonstration-fixture'
  | 'pilot-target'
  | 'not-live';
export type Disclosure = 'public-read' | 'private' | 'restricted/redacted' | 'verifiable';
export type LocalizedText = { en: string; hr: string };

export type ReleaseStage = {
  id: string;
  stage: Stage;
  headline: LocalizedText;
  support: LocalizedText;
  capabilityState: CapabilityState;
  disclosure: Disclosure[];
  sourceRefs: string[];
  fixtureId: string;
};

export const stages: ReleaseStage[] = [
  {
    id: 'voice',
    stage: 'voice',
    headline: {
      en: 'You said something. What happened next?',
      hr: 'Nešto ste prijavili. Što se dogodilo poslije?',
    },
    support: {
      en: 'A resident files a complaint, asks a question, or reports a broken process. The report enters an office. The public trail usually ends at “submitted”.',
      hr: 'Stanovnik podnosi pritužbu, postavlja pitanje ili prijavljuje postupak koji ne funkcionira. Prijava ulazi u ured. Javni trag najčešće završava na „zaprimljeno”.',
    },
    capabilityState: 'demonstration-fixture',
    disclosure: ['public-read'],
    sourceRefs: [
      'design-lab/pitch/product-pitch.md §6 beat 1',
      'design-lab/pitch/brief-core.md',
      'design-lab/pitch/provenance/fixtures.md',
    ],
    fixtureId: 'voice-vrsar-001',
  },
  {
    id: 'responsibility',
    stage: 'responsibility',
    headline: {
      en: 'Public accountability does not require public case files.',
      hr: 'Javna odgovornost ne traži javne spise predmeta.',
    },
    support: {
      en: 'The resident sees their case. Staff work the restricted file. The public sees the process, the responsible office, and the response obligation — never the narrative or identity.',
      hr: 'Stanovnik vidi svoj predmet. Službenici rade na ograničenom spisu. Javnost vidi postupak, nadležni ured i obvezu odgovora — nikada opis slučaja ni identitet.',
    },
    capabilityState: 'implemented-locally',
    disclosure: ['public-read', 'private'],
    sourceRefs: [
      'design-lab/pitch/product-pitch.md §6 beat 6',
      'apps/web/src/pages/complaints/',
      'apps/admin/src/pages/complaints.astro',
      'packages/policy-rules/',
    ],
    fixtureId: 'boundary-case-002',
  },
  {
    id: 'response',
    stage: 'response',
    headline: {
      en: 'An official can promise a fix. They cannot grade their own follow-through.',
      hr: 'Dužnosnik može obećati popravak. Ne može sam ocijeniti vlastito izvršenje.',
    },
    support: {
      en: 'A commitment starts PENDING REVIEW after the charter and scope gate. It publishes only after a distinct independent review, and a terminal resolution needs review too.',
      hr: 'Obveza nakon povelje i provjere opsega kreće u stanju ČEKA NEOVISNU PROVJERU. Objavljuje se tek nakon zasebne neovisne provjere, a i konačni ishod traži provjeru.',
    },
    capabilityState: 'demonstration-fixture',
    disclosure: ['public-read'],
    sourceRefs: [
      'design-lab/pitch/product-pitch.md §3 commitment filing decision',
      'design-lab/pitch/product-pitch.md §6 beats 7–8',
      'services/contribution-service/src/representative-routes.ts',
    ],
    fixtureId: 'commitment-vrsar-003',
  },
  {
    id: 'check',
    stage: 'check',
    headline: {
      en: 'Do not trust the screenshot. Check the bytes.',
      hr: 'Nemojte vjerovati snimci zaslona. Provjerite bajtove.',
    },
    support: {
      en: 'The check runs in this browser against frozen test material. Nothing is uploaded or requested. A match shows the registered bytes match; it does not make the claim true.',
      hr: 'Provjera se izvodi u ovom pregledniku usporedbom sa zamrznutim testnim materijalom. Ništa se ne šalje niti traži. Podudaranje pokazuje da se zabilježeni bajtovi slažu; ne čini tvrdnju istinitom.',
    },
    capabilityState: 'implemented-locally',
    disclosure: ['verifiable'],
    sourceRefs: [
      'design-lab/pitch/product-pitch.md §6 beat 9',
      'design-lab/pitch/provenance/fixtures.md',
      'design-lab/pitch/prototype/src/lib/verifier.ts',
    ],
    fixtureId: 'proof-vrsar-004',
  },
  {
    id: 'receipt',
    stage: 'receipt',
    headline: {
      en: 'Which public process should stop disappearing into the system?',
      hr: 'Koji javni postupak više ne smije nestajati u sustavu?',
    },
    support: {
      en: 'Start with one written charter: public process, named owners, data boundaries, a measurable public result, rollback conditions, retention, and a sunset.',
      hr: 'Krenite od jedne pisane povelje: javni postupak, imenovani nositelji, granice podataka, mjerljiv javni rezultat, uvjeti obustave, rok čuvanja i rok prestanka primjene.',
    },
    capabilityState: 'pilot-target',
    disclosure: ['public-read'],
    sourceRefs: [
      'design-lab/pitch/product-pitch.md §6 beats 13–15',
      'docs/partners/pilot-charter-template.md',
      'docs/pilot/charter.md',
    ],
    fixtureId: 'pilot-vrsar-005',
  },
];

export const stageLabels: Record<Stage, LocalizedText> = {
  voice: { en: 'Voice', hr: 'Glas' },
  responsibility: { en: 'Responsibility', hr: 'Odgovornost' },
  response: { en: 'Response', hr: 'Odgovor' },
  check: { en: 'Independent check', hr: 'Neovisna provjera' },
  receipt: { en: 'Public receipt', hr: 'Javna potvrda' },
};

export const capabilityLabels: Record<CapabilityState, LocalizedText> = {
  'implemented-locally': { en: 'implemented locally', hr: 'izvedeno lokalno' },
  'demonstration-fixture': { en: 'demonstration fixture', hr: 'demonstracijski primjer' },
  'pilot-target': { en: 'pilot target', hr: 'cilj pilot-projekta' },
  'not-live': { en: 'not live', hr: 'nije aktivno' },
};

export const disclosureLabels: Record<Disclosure, LocalizedText> = {
  'public-read': { en: 'public read', hr: 'javni uvid' },
  private: { en: 'private', hr: 'privatno' },
  'restricted/redacted': { en: 'restricted / redacted', hr: 'ograničeno / anonimizirano' },
  verifiable: { en: 'locally checkable', hr: 'lokalno provjerljivo' },
};

export const statusLabels = {
  public: { en: 'PUBLIC', hr: 'JAVNO' },
  demonstrationFixture: {
    en: 'DEMONSTRATION FIXTURE',
    hr: 'DEMONSTRACIJSKI PRIMJER',
  },
  privateRestricted: { en: 'PRIVATE / RESTRICTED', hr: 'PRIVATNO / OGRANIČENO' },
  pendingReview: { en: 'PENDING REVIEW', hr: 'ČEKA NEOVISNU PROVJERU' },
  awaitingReview: {
    en: 'AWAITING INDEPENDENT REVIEW',
    hr: 'ČEKA NEOVISNU PROVJERU',
  },
  publicationTransition: {
    en: 'PENDING REVIEW → PUBLISHED',
    hr: 'ČEKA NEOVISNU PROVJERU → OBJAVLJENO',
  },
  verifiedLocal: { en: 'VERIFIED LOCALLY', hr: 'LOKALNO PROVJERENO' },
  pilotTarget: { en: 'PILOT TARGET', hr: 'CILJ PILOT-PROJEKTA' },
  notLive: { en: 'NOT LIVE', hr: 'NIJE AKTIVNO' },
  localProofRegistry: {
    en: 'LOCAL PROOF REGISTRY / TEST MATERIAL',
    hr: 'LOKALNI REGISTAR DOKAZA / TESTNI MATERIJAL',
  },
  exactMatch: { en: 'EXACT MATCH', hr: 'POTPUNO PODUDARANJE' },
  mismatch: { en: 'CHANGED BYTE — NO MATCH', hr: 'PROMIJENJEN BAJT — NEMA PODUDARANJA' },
} satisfies Record<string, LocalizedText>;

export type RecordEvent = {
  stage: Stage;
  actor: LocalizedText;
  action: LocalizedText;
  status: LocalizedText;
  at: string;
  hashFragment: string;
};

export const record: { id: string; events: RecordEvent[] } = {
  id: 'REC-TEST-0148',
  events: [
    {
      stage: 'voice',
      actor: { en: 'Resident (synthetic)', hr: 'Stanovnik (izmišljeni)' },
      action: { en: 'Report submitted', hr: 'Prijava zaprimljena' },
      status: { en: 'submitted', hr: 'zaprimljeno' },
      at: '2026-03-04T09:12:00Z',
      hashFragment: '4a17c9',
    },
    {
      stage: 'responsibility',
      actor: { en: 'Public service office (test)', hr: 'Ured za javne usluge (testni)' },
      action: { en: 'Responsible office assigned', hr: 'Dodijeljen nadležni ured' },
      status: { en: 'responsibility assigned', hr: 'odgovornost dodijeljena' },
      at: '2026-03-06T11:40:00Z',
      hashFragment: 'b0d3e1',
    },
    {
      stage: 'response',
      actor: { en: 'Mandate holder (test)', hr: 'Nositelj mandata (testni)' },
      action: { en: 'Commitment filed, pending review', hr: 'Obveza podnesena, čeka provjeru' },
      status: { en: 'pending review', hr: 'čeka neovisnu provjeru' },
      at: '2026-03-19T14:05:00Z',
      hashFragment: '7c25af',
    },
    {
      stage: 'check',
      actor: { en: 'Independent reviewer (test)', hr: 'Neovisni provjeritelj (testni)' },
      action: { en: 'Evidence checked against test material', hr: 'Dokazi provjereni usporedbom s testnim materijalom' },
      status: { en: 'review accepted', hr: 'provjera prihvaćena' },
      at: '2026-04-02T08:31:00Z',
      hashFragment: 'e9f402',
    },
    {
      stage: 'receipt',
      actor: { en: 'Public record (test)', hr: 'Javni zapis (testni)' },
      action: {
        en: 'Publication followed independent review',
        hr: 'Objava je uslijedila nakon neovisne provjere',
      },
      status: {
        en: 'PENDING REVIEW → PUBLISHED',
        hr: 'ČEKA NEOVISNU PROVJERU → OBJAVLJENO',
      },
      at: '2026-04-02T08:33:00Z',
      hashFragment: '15c8bd',
    },
  ],
};

export const commitment = {
  id: 'COM-TEST-003',
  title: {
    en: 'Fictional test commitment: one residence proof per service request',
    hr: 'Izmišljena testna obveza: jedan dokaz o prebivalištu po zahtjevu za uslugu',
  },
  criterion: {
    en: 'A resident submits residence evidence once per request; no office asks for the same document a second time. Fictional test criterion, not an agreed target.',
    hr: 'Stanovnik dokaz o prebivalištu podnosi jednom po zahtjevu; nijedan ured ne traži isti dokument drugi put. Izmišljeni testni kriterij, nije dogovoreni cilj.',
  },
  due: '2026-11-30',
  status: 'pending-review' as const,
};

export const privateCategories: LocalizedText[] = [
  { en: 'Identity document', hr: 'Osobna isprava' },
  { en: 'Case narrative', hr: 'Opis slučaja' },
  { en: 'Contact details', hr: 'Podaci za kontakt' },
  { en: 'Internal notes', hr: 'Interne bilješke' },
];

export const verifierFixture = {
  fixtureId: 'proof-vrsar-004',
  fileName: 'charter-test-fixture.txt',
  mechanism: {
    en: 'Deterministic 32-bit test digest; not SHA-256',
    hr: 'Deterministički 32-bitni testni sažetak; nije SHA-256',
  },
  registered: '8758ce68',
  matchComputed: '8758ce68',
  mismatchComputed: '5ffd9410',
};

export const receiptFixtureId = 'receipt-vrsar-006';

export type ReceiptRow = {
  seq: number;
  event: LocalizedText;
  at: string;
  hash: string;
  previousHash: string;
};

export const receiptRows: ReceiptRow[] = [
  {
    seq: 1,
    event: { en: 'Commitment filed', hr: 'Obveza podnesena' },
    at: '2026-03-19T14:05:00Z',
    hash: '7c25af',
    previousHash: '000000',
  },
  {
    seq: 2,
    event: { en: 'Evidence submitted', hr: 'Dokazi podneseni' },
    at: '2026-03-27T10:22:00Z',
    hash: 'd41b06',
    previousHash: '7c25af',
  },
  {
    seq: 3,
    event: { en: 'Independent review accepted', hr: 'Neovisna provjera prihvaćena' },
    at: '2026-04-02T08:31:00Z',
    hash: 'e9f402',
    previousHash: 'd41b06',
  },
  {
    seq: 4,
    event: {
      en: 'PENDING REVIEW → PUBLISHED',
      hr: 'ČEKA NEOVISNU PROVJERU → OBJAVLJENO',
    },
    at: '2026-04-02T08:33:00Z',
    hash: '15c8bd',
    previousHash: 'e9f402',
  },
];

export const pilotQuestions: LocalizedText[] = [
  {
    en: 'What process creates repeated confusion, handoffs, or unanswered reports?',
    hr: 'Koji postupak stvara stalne nejasnoće, prebacivanje između ureda ili prijave bez odgovora?',
  },
  { en: 'Which office owns the response?', hr: 'Koji je ured nositelj odgovora?' },
  { en: 'Which case material must remain private?', hr: 'Koji dio spisa mora ostati privatan?' },
  {
    en: 'Which commitment and outcome can be public?',
    hr: 'Koja obveza i koji ishod mogu biti javni?',
  },
  {
    en: 'Who can independently review the result?',
    hr: 'Tko može neovisno provjeriti rezultat?',
  },
];

export const releaseBanner: LocalizedText = {
  en: 'Demonstration with fictional data — not a live service. Vrsar is a prospective pilot target only.',
  hr: 'Demonstracija s izmišljenim podacima — nije aktivna usluga. Vrsar je samo cilj pilot-projekta.',
};

export const releaseBannerDetails: LocalizedText = {
  en: 'Details',
  hr: 'Pojedinosti',
};

export const vrsarBoundary: LocalizedText = {
  en: 'Općina Vrsar is a pilot target only: no engagement, authorization, data, deployment, or outcome is implied.',
  hr: 'Općina Vrsar je samo cilj pilot-projekta: iz toga ne proizlazi nikakva suradnja, ovlaštenje, podaci, uvođenje ni ishod.',
};

export const copy = {
  en: {
    skipToRecord: 'Skip to the public record',
    current: 'here',
    record: 'Record',
    report: 'Report',
    intake: 'Intake',
    publicTrailEnds: 'The public trail usually ends here',
    appendedHere: 'appended here',
    ofStages: 'of 5 stages',
    proposedCount: '2 appended · 1 proposed',
    newestEvent: 'Newest appended event',
    eventStatus: 'Status change',
    capability: 'Capability state',
    disclosure: 'Disclosure',
    fixture: 'Fixture',
    sources: 'Sources',
    publicFields: 'Public response fields',
    responsibleOffice: 'Responsible office',
    responseObligation: 'Response obligation',
    officeValue: 'Public service office (test)',
    obligationValue: 'Assign an owner and publish a scoped response obligation',
    withheld: 'Withheld from the public record',
    notPublished: 'not published',
    commitment: 'Commitment',
    criterion: 'Criterion',
    due: 'Due',
    terminalBlocked: 'TERMINAL STATE BLOCKED',
    reviewRule: 'The contributor cannot be the reviewer. Publication and terminal status remain blocked until a distinct independent review is accepted.',
    localVerifier: 'Local verifier demonstration',
    checkedFile: 'Fixture file',
    registered: 'Registered test value',
    computed: 'Computed test value',
    mechanism: 'Mechanism',
    result: 'Result',
    bytesStay: 'Frozen text is checked in this browser. No upload, fetch, API request, or data storage occurs.',
    truthLimit: 'A match shows the registered bytes match; it does not make the claim true.',
    useOriginal: 'Use exact fixture bytes',
    changeByte: 'Change one byte',
    receipt: 'Public receipt',
    receiptCaption: 'Synthetic hash-linked receipt excerpt',
    link: 'link',
    sequence: 'seq',
    event: 'event',
    time: 'time',
    hash: 'hash',
    previousHash: 'previousHash',
    reviewAccepted: 'independent review accepted',
    publicationFollowedReview: 'Publication followed independent review.',
    publicationLimit: 'Published is a publication status. It does not claim the promise is fulfilled or terminally resolved.',
    pilotWorksheet: 'Five questions for one scoped pilot charter',
    pilotInstruction: 'Use these questions in a working session. This page accepts and stores no answers.',
    previous: 'Previous stage',
    next: 'Next stage',
    fullscreen: 'Enter fullscreen',
    exitFullscreen: 'Exit fullscreen',
    fullscreenDenied: 'Fullscreen was not available. Continue presenting in this window.',
    presentationProgress: 'Presentation progress',
    stageNavigation: 'Response-loop stages',
  },
  hr: {
    skipToRecord: 'Preskoči na javni zapis',
    current: 'ovdje',
    record: 'Zapis',
    report: 'Prijava',
    intake: 'Zaprimanje',
    publicTrailEnds: 'Javni trag najčešće završava ovdje',
    appendedHere: 'ovdje upisano',
    ofStages: 'od 5 faza',
    proposedCount: '2 upisano · 1 predloženo',
    newestEvent: 'Najnoviji upisani događaj',
    eventStatus: 'Promjena statusa',
    capability: 'Stanje mogućnosti',
    disclosure: 'Razina javnosti',
    fixture: 'Primjer',
    sources: 'Izvori',
    publicFields: 'Polja javnog odgovora',
    responsibleOffice: 'Nadležni ured',
    responseObligation: 'Obveza odgovora',
    officeValue: 'Ured za javne usluge (testni)',
    obligationValue: 'Odrediti nositelja i objaviti obvezu odgovora s jasnim opsegom',
    withheld: 'Zadržano izvan javnog zapisa',
    notPublished: 'nije objavljeno',
    commitment: 'Obveza',
    criterion: 'Kriterij',
    due: 'Rok',
    terminalBlocked: 'KONAČNO STANJE ZAKLJUČANO',
    reviewRule: 'Podnositelj ne može biti provjeritelj. Objava i konačni status ostaju zaključani dok zasebna neovisna provjera ne bude prihvaćena.',
    localVerifier: 'Demonstracija lokalne provjere',
    checkedFile: 'Datoteka primjera',
    registered: 'Zabilježena testna vrijednost',
    computed: 'Izračunata testna vrijednost',
    mechanism: 'Mehanizam',
    result: 'Rezultat',
    bytesStay: 'Zamrznuti tekst provjerava se u ovom pregledniku. Nema slanja, dohvata, zahtjeva prema API-ju ni pohrane podataka.',
    truthLimit: 'Podudaranje pokazuje da se zabilježeni bajtovi slažu; ne čini tvrdnju istinitom.',
    useOriginal: 'Koristi izvorne bajtove primjera',
    changeByte: 'Promijeni jedan bajt',
    receipt: 'Javna potvrda',
    receiptCaption: 'Izvadak iz sintetičke hash-povezane potvrde',
    link: 'veza',
    sequence: 'seq',
    event: 'događaj',
    time: 'vrijeme',
    hash: 'hash',
    previousHash: 'previousHash',
    reviewAccepted: 'neovisna provjera prihvaćena',
    publicationFollowedReview: 'Objava je uslijedila nakon neovisne provjere.',
    publicationLimit: '„Objavljeno” je status objave. Ne tvrdi da je obećanje ispunjeno ni konačno riješeno.',
    pilotWorksheet: 'Pet pitanja za povelju jednog ograničenog pilot-projekta',
    pilotInstruction: 'Upotrijebite ova pitanja u radnom sastanku. Ova stranica ne prihvaća niti pohranjuje odgovore.',
    previous: 'Prethodna faza',
    next: 'Sljedeća faza',
    fullscreen: 'Pokreni prikaz preko cijelog zaslona',
    exitFullscreen: 'Izađi iz prikaza preko cijelog zaslona',
    fullscreenDenied: 'Prikaz preko cijelog zaslona nije dostupan. Nastavite izlaganje u ovom prozoru.',
    presentationProgress: 'Napredak izlaganja',
    stageNavigation: 'Faze kruga odgovora',
  },
} as const;

export const landingEntryIds = [
  'citizen',
  'official',
  'review',
  'record',
  'embed',
  'presentation',
] as const;

export type LandingEntryId = (typeof landingEntryIds)[number];

export const landing = {
  en: {
    headline: 'Follow one public response from the first report to the receipt.',
    lede: 'Polis is the public response layer between community voice and government action. A resident raises a problem, a named office takes responsibility, an official files a commitment, an independent reviewer checks it, and the public record keeps the receipt.',
    loopTitle: 'The response loop',
    entriesTitle: 'Open the demonstration',
    demoNote:
      'What you do in the demonstration stays in this browser. Nothing is sent anywhere, and a reset restores the starting records.',
    entries: {
      citizen: {
        label: 'Try it as a citizen',
        note: 'File a report and follow where it goes.',
      },
      official: {
        label: 'As an official',
        note: 'Accept responsibility and file a commitment you cannot publish yourself.',
      },
      review: {
        label: 'As the independent reviewer',
        note: 'Read the evidence, then publish the commitment or return it.',
      },
      record: {
        label: 'Follow a public record',
        note: 'One record, every appended event, and the hash-linked receipt.',
      },
      embed: {
        label: "On your municipality's website",
        note: 'The same reporting interface inside a fictional town site.',
      },
      presentation: {
        label: 'Watch the presentation',
        note: 'A staged walk through the whole loop, with presenter controls.',
      },
    },
  },
  hr: {
    headline: 'Pratite jedan javni odgovor od prve prijave do potvrde.',
    lede: 'Polis je sloj javnog odgovora između glasa zajednice i djelovanja vlasti. Stanovnik prijavljuje problem, imenovani ured preuzima odgovornost, dužnosnik podnosi obvezu, neovisni provjeritelj ju provjerava, a javni zapis čuva potvrdu.',
    loopTitle: 'Krug odgovora',
    entriesTitle: 'Otvorite demonstraciju',
    demoNote:
      'Ono što učinite u demonstraciji ostaje u ovom pregledniku. Ništa se nikamo ne šalje, a demo možete vratiti na početak.',
    entries: {
      citizen: {
        label: 'Isprobajte kao stanovnik',
        note: 'Podnesite prijavu i pratite kamo ide.',
      },
      official: {
        label: 'Kao dužnosnik',
        note: 'Preuzmite odgovornost i podnesite obvezu koju ne možete sami objaviti.',
      },
      review: {
        label: 'Kao neovisni provjeritelj',
        note: 'Pročitajte dokaze pa obvezu objavite ili vratite.',
      },
      record: {
        label: 'Pratite javni zapis',
        note: 'Jedan zapis, svi upisani događaji i hash-povezana potvrda.',
      },
      embed: {
        label: 'Na mrežnim stranicama vašeg grada',
        note: 'Isto sučelje za prijavu unutar stranice izmišljenoga grada.',
      },
      presentation: {
        label: 'Pogledajte prezentaciju',
        note: 'Vođeni prikaz cijeloga kruga, s upravljanjem za izlagača.',
      },
    },
  },
} as const;

export const directionContract = `IMPECCABLE CONTRACT
THESIS: An unanswered report becomes a followable public response loop with a receipt.
OWN-WORLD: A calm light civic reading room; one synthetic record is the only hero.
STORY: voice → responsibility → response → independent check → receipt, told through one record under honest labels.
FIRST VIEWPORT: A submitted report slides into intake and the public trail stops; no hero, no dashboard, no lecture.
FORM: key 01e00c52; the locked Trace line direction governs the product surface.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md`;
