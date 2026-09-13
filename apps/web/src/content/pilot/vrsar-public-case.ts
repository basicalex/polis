// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Copy for the public case surface: the case-number lookup, the public case
 * shell at /pilot/vrsar/zapis/<broj>, the attention control, and the channel
 * help block. Croatian is authored first; Italian and English follow the same
 * shape as src/content/pilot/vrsar.ts so the language switcher keeps working.
 *
 * Every string a reader sees on that surface lives here, so a native editor can
 * review the Croatian in one file.
 */

import type { LocalizedText, PilotLang } from './vrsar';

const localized = (hr: string, it: string, en: string): LocalizedText => Object.freeze({ hr, it, en });

/** A case number as the channel gateway issues it, e.g. VRS-1842. */
export const CASE_NUMBER_PATTERN = '[A-Z]{2,4}-[0-9]{1,8}';
export const caseNumberRegExp = /^[A-Z]{2,4}-\d{1,8}$/;

export function isCaseNumber(value: string): boolean {
  return caseNumberRegExp.test(value);
}

export function publicCaseHref(caseNumber: string, lang: PilotLang): string {
  return `/pilot/vrsar/zapis/${encodeURIComponent(caseNumber)}?lang=${lang}`;
}

export const publicCaseCopy = Object.freeze({
  page: {
    heading: localized('Javni zapis predmeta', 'Record pubblico del caso', 'Public case record'),
    intro: localized(
      'Javni zapis postoji od zaprimanja prijave. Pokazuje stanje, rok i pozornost javnosti. Javni tekst objavljuje se tek nakon neovisne provjere.',
      'Il record pubblico esiste dal momento della ricezione. Mostra lo stato, il termine e l’attenzione pubblica. Il testo pubblico viene pubblicato solo dopo la revisione indipendente.',
      'The public record exists from the moment the report is received. It shows the state, the due date, and public attention. Public text publishes only after independent review.',
    ),
  },

  lookup: {
    heading: localized('Otvorite predmet po broju', 'Apri un caso con il numero', 'Open a case by number'),
    label: localized('Broj predmeta', 'Numero del caso', 'Case number'),
    hint: localized(
      'Broj ste dobili u odgovoru na prijavu. Oblik je VRS-1842.',
      'Hai ricevuto il numero nella risposta alla segnalazione. Il formato è VRS-1842.',
      'You received the number in the reply to your report. The format is VRS-1842.',
    ),
    submit: localized('Otvori zapis', 'Apri il record', 'Open record'),
    invalid: localized(
      'Broj predmeta ima oblik VRS-1842.',
      'Il numero del caso ha il formato VRS-1842.',
      'A case number has the form VRS-1842.',
    ),
  },

  shell: {
    heading: localized('Stanje predmeta', 'Stato del caso', 'Case state'),
    caseNumber: localized('Broj predmeta', 'Numero del caso', 'Case number'),
    area: localized('Područje', 'Area', 'Area'),
    category: localized('Kategorija', 'Categoria', 'Category'),
    trace: localized('Tijek', 'Percorso', 'Path'),
    time: localized('Vrijeme', 'Tempo', 'Time'),
    due: localized('Rok', 'Termine', 'Due'),
    daysOne: localized('dan od zaprimanja', 'giorno dalla ricezione', 'day since filing'),
    daysMany: localized('dana od zaprimanja', 'giorni dalla ricezione', 'days since filing'),
    pendingPublicText: localized(
      'Javni sadržaj još nije odobren. Objavljuje se tek nakon neovisne provjere.',
      'Il contenuto pubblico non è ancora approvato. Viene pubblicato solo dopo la revisione indipendente.',
      'The public text is not approved yet. It publishes only after independent review.',
    ),
    notFound: localized('Predmet nije pronađen.', 'Caso non trovato.', 'The case was not found.'),
    notFoundHint: localized(
      'Provjerite broj i pokušajte ponovno.',
      'Controlla il numero e riprova.',
      'Check the number and try again.',
    ),
  },

  /*
   * Why there is no published text yet, said in the words of the stage the case
   * actually stands in. A reader should never have to guess whether the silence
   * means nobody looked or somebody is looking.
   */
  pending: {
    heading: localized('Zašto javnog teksta još nema', 'Perché il testo pubblico non c’è ancora', 'Why there is no public text yet'),
    received: localized(
      'Prijava je zaprimljena i dobila je broj. Javni tekst nastaje tek kad nadležni ured predloži obvezu i kad je provjeritelj neovisan o tom uredu odobri.',
      'La segnalazione è stata ricevuta e ha un numero. Il testo pubblico nasce solo quando l’ufficio responsabile propone un impegno e un revisore indipendente da quell’ufficio lo approva.',
      'The report is received and has a number. Public text appears only once the responsible office proposes a commitment and a reviewer independent of that office approves it.',
    ),
    assigned: localized(
      'Predmet ima nadležni ured. Njegov odgovor još nije napisan ni poslan na neovisnu provjeru, pa javnog teksta još nema.',
      'Il caso ha un ufficio responsabile. La sua risposta non è ancora scritta né inviata alla revisione indipendente, quindi il testo pubblico non c’è.',
      'The case has a responsible office. Its answer is not written or sent for independent review yet, so there is no public text.',
    ),
    'in-review': localized(
      'Ured je predložio obvezu. Sada o njoj odlučuje provjeritelj neovisan o tom uredu; tekst se objavljuje tek ako je prihvati.',
      'L’ufficio ha proposto un impegno. Ora decide un revisore indipendente da quell’ufficio; il testo si pubblica solo se lo accetta.',
      'The office proposed a commitment. A reviewer independent of that office now decides on it; the text publishes only if it is accepted.',
    ),
    closed: localized(
      'Predmet je zatvoren bez javne obveze. Razlog zatvaranja stoji uz stanje predmeta.',
      'Il caso è stato chiuso senza un impegno pubblico. La motivazione è indicata accanto allo stato del caso.',
      'The case was closed without a public commitment. The stated reason stands next to the case state.',
    ),
    fallback: localized(
      'Javni sadržaj još nije odobren. Objavljuje se tek nakon neovisne provjere.',
      'Il contenuto pubblico non è ancora approvato. Viene pubblicato solo dopo la revisione indipendente.',
      'The public text is not approved yet. It publishes only after independent review.',
    ),
  },

  /*
   * The five public stages, said as sentences rather than labels. Each stage has
   * a past form for the part of the path the case already walked and a future
   * form for the part it has not; the stage right after the current one carries
   * the "next step" prefix so a reader knows what to wait for.
   */
  stageStory: {
    nextPrefix: localized('Sljedeći korak', 'Prossimo passo', 'Next step'),
    closedAhead: localized(
      'Predmet je zatvoren prije ovog koraka.',
      'Il caso è stato chiuso prima di questo passo.',
      'The case was closed before this step.',
    ),
    voiceDone: localized(
      'Ured je prijavu zaprimio i dodijelio joj broj predmeta.',
      'L’ufficio ha ricevuto la segnalazione e le ha assegnato un numero.',
      'The office received the report and gave it a case number.',
    ),
    voiceNext: localized(
      'prijava se zaprima i dobiva broj predmeta.',
      'la segnalazione viene ricevuta e riceve un numero.',
      'the report is received and gets a case number.',
    ),
    responsibilityDone: localized(
      'Predmet je dodijeljen nadležnom uredu.',
      'Il caso è stato assegnato all’ufficio responsabile.',
      'The case was assigned to the responsible office.',
    ),
    responsibilityNext: localized(
      'predmet se dodjeljuje nadležnom uredu.',
      'il caso viene assegnato all’ufficio responsabile.',
      'the case is assigned to the responsible office.',
    ),
    responseDone: localized(
      'Ured je predložio javnu obvezu s rokom.',
      'L’ufficio ha proposto un impegno pubblico con un termine.',
      'The office proposed a public commitment with a due date.',
    ),
    responseNext: localized(
      'ured predlaže javnu obvezu s rokom.',
      'l’ufficio propone un impegno pubblico con un termine.',
      'the office proposes a public commitment with a due date.',
    ),
    checkDone: localized(
      'Provjeritelj neovisan o zaduženom uredu prihvatio je obvezu.',
      'Un revisore indipendente dall’ufficio incaricato ha accettato l’impegno.',
      'A reviewer independent of the assigned office accepted the commitment.',
    ),
    checkNow: localized(
      'Obveza je kod provjeritelja neovisnog o zaduženom uredu. Odluka se čeka.',
      'L’impegno è presso un revisore indipendente dall’ufficio incaricato. La decisione è attesa.',
      'The commitment is with a reviewer independent of the assigned office. The decision is pending.',
    ),
    checkNext: localized(
      'provjeritelj neovisan o zaduženom uredu odlučuje smije li se obveza objaviti.',
      'un revisore indipendente dall’ufficio incaricato decide se l’impegno può essere pubblicato.',
      'a reviewer independent of the assigned office decides whether the commitment may publish.',
    ),
    receiptDone: localized(
      'Obveza i rok su javni.',
      'L’impegno e il termine sono pubblici.',
      'The commitment and the due date are public.',
    ),
    receiptResolved: localized(
      'Ured je prijavio dovršetak, a zasebna neovisna provjera ga je prihvatila.',
      'L’ufficio ha dichiarato il completamento e una revisione indipendente separata lo ha accettato.',
      'The office reported completion and a separate independent review accepted it.',
    ),
    receiptNext: localized(
      'obveza, rok i dokazi o dovršetku postaju javni.',
      'impegno, termine e prove del completamento diventano pubblici.',
      'the commitment, the due date and the completion evidence become public.',
    ),
  },

  /* The approved answer, and the block that lets anyone check it. */
  answer: {
    heading: localized('Odgovor općine', 'La risposta del comune', 'The municipality’s answer'),
    note: localized(
      'Ovaj je tekst prošao neovisnu provjeru prije objave. Ured ga više ne može tiho promijeniti.',
      'Questo testo ha superato una revisione indipendente prima della pubblicazione. L’ufficio non può più modificarlo in silenzio.',
      'This text passed independent review before it published. The office can no longer change it quietly.',
    ),
    doneHeading: localized('Što je učinjeno', 'Che cosa è stato fatto', 'What was done'),
  },

  verification: {
    heading: localized('Provjera', 'Verifica', 'Verification'),
    note: localized(
      'Pet zapisa ispod nastaju redom i svaki nosi otisak prethodnoga. Otisak potvrde vrijedi za cijeli lanac.',
      'I cinque record qui sotto nascono in ordine e ognuno porta l’impronta del precedente. L’impronta della ricevuta vale per tutta la catena.',
      'The five records below are written in order and each carries the fingerprint of the one before it. The receipt hash covers the whole chain.',
    ),
    events: localized('Zapisi predmeta', 'Record del caso', 'Case records'),
  },

  /**
   * Reviewed stamps for the public case shell. They are meaning labels, not
   * descriptions: never paraphrase them, change them only here.
   */
  state: {
    received: localized('ZAPRIMLJENO', 'RICEVUTO', 'RECEIVED'),
    assigned: localized('DODIJELJENO', 'ASSEGNATO', 'ASSIGNED'),
    'in-review': localized('U PROVJERI', 'IN VERIFICA', 'IN REVIEW'),
    published: localized('OBJAVLJENO', 'PUBBLICATO', 'PUBLISHED'),
    resolved: localized('RIJEŠENO', 'RISOLTO', 'RESOLVED'),
    closed: localized('ZATVORENO', 'CHIUSO', 'CLOSED'),
  } as Readonly<Record<string, LocalizedText>>,

  attention: {
    heading: localized('Pozornost javnosti', 'Attenzione pubblica', 'Public attention'),
    alsoAffectedCount: localized('Isti problem', 'Stesso problema', 'Same problem'),
    alsoAffectedAdd: localized('Imam isti problem', 'Ho lo stesso problema', 'I have the same problem'),
    followCount: localized('Prati', 'Segui', 'Follow'),
    followAdd: localized('Prati', 'Segui', 'Follow'),
    withdraw: localized('Povuci', 'Ritira', 'Withdraw'),
    notAVote: localized(
      'Ovo nije glasovanje. Broj ne mijenja redoslijed obrade.',
      'Non è un voto. Il numero non cambia l’ordine di trattazione.',
      'This is not a vote. The number does not change the order of handling.',
    ),
    failed: localized(
      'Oznaka nije spremljena. Pokušajte ponovno.',
      'Il segnale non è stato salvato. Riprova.',
      'The mark was not saved. Try again.',
    ),
  },

  channel: {
    heading: localized('Prijava pozivom ili SMS-om', 'Segnalazione per telefono o SMS', 'Reporting by call or SMS'),
    numberLabel: localized('Broj za prijavu', 'Numero per le segnalazioni', 'Reporting number'),
    numberUnset: localized(
      '+385 — (broj još nije aktivan)',
      '+385 — (numero non ancora attivo)',
      '+385 — (number not active yet)',
    ),
    inactiveStamp: localized('NIJE AKTIVNO', 'NON ATTIVO', 'NOT ACTIVE'),
    privacyLine: localized(
      'Vaš broj telefona nikada ne ulazi u javni zapis.',
      'Il tuo numero di telefono non entra mai nel record pubblico.',
      'Your phone number never enters the public record.',
    ),
    recordingLine: localized(
      'Snimka poziva glasovno se izobličuje, prepisuje u tekst i zatim briše.',
      'La registrazione viene distorta nella voce, trascritta e poi cancellata.',
      'The recording is voice-distorted, transcribed, then deleted.',
    ),
    tariffLine: localized(
      'Pozivi i SMS poruke naplaćuju se po tarifi vašeg operatera.',
      'Chiamate e SMS sono tariffati dal tuo operatore.',
      'Calls and SMS are charged at your operator’s tariff.',
    ),
  },
});

export function translatedCaseState(state: unknown, lang: PilotLang): string {
  const key = typeof state === 'string' ? state : '';
  return publicCaseCopy.state[key]?.[lang] ?? publicCaseCopy.state.received[lang];
}

/**
 * The word carries the state; the tone only reinforces it (rule P4). A closed
 * shell stays neutral: closure is an outcome, not a failure.
 */
const caseStateTones: Readonly<Record<string, string>> = Object.freeze({
  received: 'trace',
  assigned: 'warning',
  'in-review': 'warning',
  published: 'valid',
  resolved: 'valid',
  closed: 'unknown',
});

export function caseStateTone(state: unknown): string {
  const key = typeof state === 'string' ? state : '';
  return caseStateTones[key] ?? 'unknown';
}
