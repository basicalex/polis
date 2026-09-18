// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Copy for the public case surface: the case-number lookup, the public case
 * shell at /pilot/vrsar/zapis/<broj> and /<mjesto>/zapis/<broj>, the attention
 * control, and the channel help block. Croatian is authored first; Italian and
 * English follow the same shape as src/content/pilot/vrsar.ts so the language
 * switcher keeps working.
 *
 * Every string a reader sees on that surface lives here, so a native editor can
 * review the Croatian in one file.
 *
 * The public text policy of 2026-09-16 rules this file: the report text is
 * public from the moment of filing, the responsible official signs the answer
 * under their own name, and the public checks the completion. Nothing here may
 * promise a review by anyone else.
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
      'Tekst prijave javan je od trenutka podnošenja. Zapis pokazuje stanje, rok, odgovor ureda i pozornost javnosti.',
      'Il testo della segnalazione è pubblico dal momento dell’invio. Il record mostra lo stato, il termine, la risposta dell’ufficio e l’attenzione pubblica.',
      'The report text is public from the moment it is filed. The record shows the state, the due date, the office answer and public attention.',
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
    notFound: localized('Predmet nije pronađen.', 'Caso non trovato.', 'The case was not found.'),
    notFoundHint: localized(
      'Provjerite broj i pokušajte ponovno.',
      'Controlla il numero e riprova.',
      'Check the number and try again.',
    ),
  },

  /*
   * The report itself. It is published as it was written, so the block says
   * exactly that and carries the hash of the original text next to it. When the
   * text is held, the same block says which category held it and what the
   * office can still do about it.
   */
  text: {
    heading: localized('Prijava', 'La segnalazione', 'The report'),
    asFiled: localized(
      'Objavljeno kako je zaprimljeno.',
      'Pubblicato come è stato ricevuto.',
      'Published as it was filed.',
    ),
    locationLabel: localized('Lokacija', 'Luogo', 'Location'),
    locationMissing: localized('Nije navedena.', 'Non indicato.', 'Not given.'),
    hashLabel: localized('Otisak izvornog teksta', 'Impronta del testo originale', 'Hash of the original text'),
    heldHeading: localized('Tekst je zadržan', 'Il testo è trattenuto', 'The text is held'),
    heldNext: localized(
      'Ured odlučuje hoće li tekst objaviti, objaviti ga bez spornog dijela ili predmet zatvoriti uz javni razlog.',
      'L’ufficio decide se pubblicare il testo, pubblicarlo senza la parte contestata o chiudere il caso con una motivazione pubblica.',
      'The office decides whether to release the text, release it without the part at issue, or close the case with a public reason.',
    ),
    redacted: localized(
      'Ured je objavio tekst bez dijela sadržaja.',
      'L’ufficio ha pubblicato il testo senza una parte del contenuto.',
      'The office published the text with a part removed.',
    ),
    redactedOn: localized('Uklonjeno', 'Rimosso il', 'Removed on'),
  },

  /*
   * A text that is gone. The filer can take their own words off the public
   * record and the retention clock takes them off on its own; either way the
   * case, its number and the hash of the original text stay where they were.
   */
  removed: {
    heading: localized('Tekst je uklonjen', 'Il testo è stato rimosso', 'The text was removed'),
    filer: localized(
      'Tekst uklonjen na zahtjev podnositelja.',
      'Testo rimosso su richiesta di chi ha segnalato.',
      'The text was removed at the filer’s request.',
    ),
    retention: localized(
      'Tekst uklonjen nakon isteka roka čuvanja.',
      'Testo rimosso alla scadenza del periodo di conservazione.',
      'The text was removed when the retention period ran out.',
    ),
    permanent: localized(
      'Uklanjanje je trajno. Otisak izvornog teksta ostaje javan.',
      'La rimozione è definitiva. L’impronta del testo originale resta pubblica.',
      'The removal is permanent. The hash of the original text stays public.',
    ),
  },

  /*
   * What a reader can do about a text that should not stand: name the category
   * and, if they want, say more. The office decides; the count is not public.
   */
  notice: {
    open: localized('Prijavi ovaj tekst', 'Segnala questo testo', 'Report this text'),
    intro: localized(
      'Ako tekst sadrži osobne podatke, uvrede ili ne pripada ovamo, recite nam.',
      'Se il testo contiene dati personali, offese o non c’entra nulla, diccelo.',
      'If the text carries personal data, abuse, or does not belong here, tell us.',
    ),
    reasonLabel: localized('Razlog', 'Motivo', 'Reason'),
    noteLabel: localized('Napomena (neobvezno)', 'Nota (facoltativa)', 'Note (optional)'),
    submit: localized('Pošalji prijavu teksta', 'Invia la segnalazione del testo', 'Send the report'),
    sent: localized('Zaprimljeno. Hvala.', 'Ricevuto. Grazie.', 'Received. Thank you.'),
    already: localized(
      'Već ste prijavili ovaj tekst.',
      'Hai già segnalato questo testo.',
      'You already reported this text.',
    ),
    failed: localized(
      'Prijava nije poslana. Pokušajte ponovno.',
      'La segnalazione non è stata inviata. Riprova.',
      'The report was not sent. Try again.',
    ),
  },

  /* The filer takes their own text off the record. Two taps, then it is gone. */
  erase: {
    open: localized('Ukloni moj tekst', 'Rimuovi il mio testo', 'Remove my text'),
    confirmHeading: localized(
      'Trajno ukloniti tekst?',
      'Rimuovere il testo in modo definitivo?',
      'Remove the text for good?',
    ),
    confirmBody: localized(
      'Tekst nestaje s javnog zapisa i ne može se vratiti. Predmet, broj i otisak teksta ostaju.',
      'Il testo sparisce dal record pubblico e non può tornare. Il caso, il numero e l’impronta del testo restano.',
      'The text leaves the public record and cannot come back. The case, its number and the text hash stay.',
    ),
    confirm: localized('Trajno ukloni', 'Rimuovi definitivamente', 'Remove for good'),
    cancel: localized('Odustani', 'Annulla', 'Cancel'),
    done: localized('Tekst je uklonjen.', 'Il testo è stato rimosso.', 'The text was removed.'),
    failed: localized(
      'Uklanjanje nije uspjelo. Pokušajte ponovno.',
      'La rimozione non è riuscita. Riprova.',
      'The removal did not go through. Try again.',
    ),
  },

  /* Where a whistleblower report goes instead of the public page. */
  confidential: {
    contact: localized(
      'Povjerljiva osoba: {name}, {email}, {phone}',
      'Persona di fiducia: {name}, {email}, {phone}',
      'Confidential officer: {name}, {email}, {phone}',
    ),
  },

  /* Public events this page writes into the trail in its own words. */
  trail: {
    textRemovedFiler: localized(
      'Javni tekst uklonjen na zahtjev podnositelja',
      'Testo pubblico rimosso su richiesta di chi ha segnalato',
      'Public text removed at the filer’s request',
    ),
    textRemovedRetention: localized(
      'Javni tekst uklonjen istekom roka čuvanja',
      'Testo pubblico rimosso alla scadenza della conservazione',
      'Public text removed when the retention period ran out',
    ),
  },

  /** Why a text is held, in the four words the compliance pass can use. */
  holdReason: {
    'personal-data': localized(
      'Tekst sadrži osobne podatke druge osobe.',
      'Il testo contiene dati personali di un’altra persona.',
      'The text carries another person’s personal data.',
    ),
    abuse: localized(
      'Tekst sadrži uvredljiv ili prijeteći sadržaj.',
      'Il testo contiene contenuti offensivi o minacciosi.',
      'The text carries abusive or threatening content.',
    ),
    'off-topic': localized(
      'Tekst se ne odnosi na komunalni problem u ovoj općini.',
      'Il testo non riguarda un problema comunale di questo comune.',
      'The text is not about a local problem in this municipality.',
    ),
    other: localized(
      'Tekst je zadržan iz drugog razloga.',
      'Il testo è trattenuto per un altro motivo.',
      'The text is held for another reason.',
    ),
    'pending-release': localized(
      'Tekst čeka objavu ureda.',
      'Il testo attende la pubblicazione da parte dell’ufficio.',
      'The text is waiting for the office to publish it.',
    ),
    policy: localized(
      'Ova općina ne objavljuje tekst prijave.',
      'Questo comune non pubblica il testo delle segnalazioni.',
      'This municipality does not publish the text of reports.',
    ),
    notices: localized(
      'Tekst je zadržan nakon prijava čitatelja.',
      'Il testo è trattenuto dopo le segnalazioni dei lettori.',
      'The text is held after readers reported it.',
    ),
    confidential: localized(
      'Prijava je upućena povjerljivoj osobi općine.',
      'La segnalazione è stata trasmessa alla persona di fiducia del comune.',
      'The report went to the municipality’s confidential officer.',
    ),
  } as Readonly<Record<string, LocalizedText>>,

  /*
   * The one soft label a case can carry. It blocks nothing and highlights
   * nothing; it says what the filter saw and gives the filer a way to object.
   */
  label: {
    formLetter: localized('Šablonska prijava', 'Segnalazione standard', 'Form letter'),
    formLetterNote: localized(
      'Tekst je gotovo jednak nedavnoj prijavi u ovoj općini. Oznaka ništa ne blokira i ne mijenja redoslijed obrade.',
      'Il testo è quasi identico a una segnalazione recente in questo comune. L’etichetta non blocca nulla e non cambia l’ordine di trattazione.',
      'The text is nearly identical to a recent report in this municipality. The label blocks nothing and changes no order of handling.',
    ),
    appeal: localized('Osporite oznaku', 'Contesta l’etichetta', 'Appeal the label'),
    appealLabel: localized('Zašto oznaka ne stoji?', 'Perché l’etichetta non è corretta?', 'Why is the label wrong?'),
    appealHint: localized(
      'Poruka ide uredu i nije javna. Oznaku uklanja ured.',
      'Il messaggio va all’ufficio e non è pubblico. L’etichetta la rimuove l’ufficio.',
      'The message goes to the office and is not public. The office clears the label.',
    ),
    appealSubmit: localized('Pošalji uredu', 'Invia all’ufficio', 'Send to the office'),
    appealSent: localized('Poruka je poslana uredu.', 'Il messaggio è stato inviato all’ufficio.', 'The message reached the office.'),
    appealFailed: localized(
      'Poruka nije poslana. Pokušajte ponovno.',
      'Il messaggio non è stato inviato. Riprova.',
      'The message was not sent. Try again.',
    ),
  },

  /*
   * What happens next, said in the words of the state the case actually stands
   * in. A reader should never have to guess who holds the case now.
   */
  pending: {
    heading: localized('Što slijedi', 'Che cosa succede ora', 'What happens next'),
    received: localized(
      'Prijava je zaprimljena i dobila je broj. Ured još nije preuzeo odgovornost za nju.',
      'La segnalazione è stata ricevuta e ha un numero. Nessun ufficio se ne è ancora assunto la responsabilità.',
      'The report is filed and has a number. No office has taken responsibility for it yet.',
    ),
    assigned: localized(
      'Predmet ima nadležni ured. Slijedi njegov potpisani odgovor s obvezom i rokom.',
      'Il caso ha un ufficio responsabile. Segue la sua risposta firmata con impegno e termine.',
      'The case has a responsible office. Its signed answer, with a commitment and a due date, comes next.',
    ),
    answered: localized(
      'Ured je objavio obvezu i rok. Sljedeći je korak prijava dovršetka s dokazom.',
      'L’ufficio ha pubblicato un impegno e un termine. Il passo successivo è la dichiarazione di completamento con prove.',
      'The office published a commitment and a due date. The next step is the completion report with evidence.',
    ),
    resolved: localized(
      'Ured je prijavio dovršetak. Sada provjerava javnost: podnositelj može osporiti, ostali mogu označiti da nije popravljeno.',
      'L’ufficio ha dichiarato il completamento. Ora controlla il pubblico: chi ha segnalato può contestare, gli altri possono indicare che non è riparato.',
      'The office reported completion. The public checks it now: the filer can dispute it, everyone else can mark it not fixed.',
    ),
    disputed: localized(
      'Podnositelj je osporio dovršetak. Ured može predmet ponovno otvoriti ili prijaviti novi dovršetak.',
      'Chi ha segnalato ha contestato il completamento. L’ufficio può riaprire il caso o dichiarare un nuovo completamento.',
      'The filer disputed the completion. The office can reopen the case or report completion again.',
    ),
    closed: localized(
      'Predmet je zatvoren. Razlog zatvaranja stoji uz stanje predmeta.',
      'Il caso è chiuso. La motivazione è indicata accanto allo stato del caso.',
      'The case is closed. The stated reason stands next to the case state.',
    ),
    fallback: localized(
      'Predmet je otvoren. Odgovor ureda stoji ovdje čim ga objavi.',
      'Il caso è aperto. La risposta dell’ufficio compare qui appena viene pubblicata.',
      'The case is open. The office answer stands here as soon as it publishes.',
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
      'Prijava je podnesena i objavljena pod brojem predmeta.',
      'La segnalazione è stata inviata e pubblicata con il numero del caso.',
      'The report was filed and published under its case number.',
    ),
    voiceNext: localized(
      'prijava se podnosi i objavljuje pod brojem predmeta.',
      'la segnalazione viene inviata e pubblicata con il numero del caso.',
      'the report is filed and published under its case number.',
    ),
    responsibilityDone: localized(
      'Predmet je preuzeo nadležni ured.',
      'Un ufficio responsabile ha preso in carico il caso.',
      'A responsible office took the case on.',
    ),
    responsibilityNext: localized(
      'nadležni ured preuzima predmet.',
      'l’ufficio responsabile prende in carico il caso.',
      'a responsible office takes the case on.',
    ),
    responseDone: localized(
      'Službena osoba potpisala je obvezu s rokom.',
      'Il funzionario ha firmato un impegno con un termine.',
      'The official signed a commitment with a due date.',
    ),
    responseNext: localized(
      'službena osoba potpisuje obvezu s rokom.',
      'il funzionario firma un impegno con un termine.',
      'the official signs a commitment with a due date.',
    ),
    checkDone: localized(
      'Ured je prijavio dovršetak i priložio dokaz.',
      'L’ufficio ha dichiarato il completamento e allegato le prove.',
      'The office reported completion and attached its evidence.',
    ),
    checkNow: localized(
      'Ured je prijavio dovršetak. Provjerava ga javnost.',
      'L’ufficio ha dichiarato il completamento. Lo controlla il pubblico.',
      'The office reported completion. The public is checking it.',
    ),
    checkDisputed: localized(
      'Podnositelj je osporio dovršetak.',
      'Chi ha segnalato ha contestato il completamento.',
      'The filer disputed the completion.',
    ),
    checkNext: localized(
      'ured prijavljuje dovršetak, a javnost ga provjerava.',
      'l’ufficio dichiara il completamento e il pubblico lo controlla.',
      'the office reports completion and the public checks it.',
    ),
    receiptDone: localized(
      'Predmet stoji kao riješen.',
      'Il caso risulta risolto.',
      'The case stands resolved.',
    ),
    receiptResolved: localized(
      'Predmet stoji kao riješen: dovršetak je prijavljen i nije osporen.',
      'Il caso risulta risolto: il completamento è stato dichiarato e non contestato.',
      'The case stands resolved: completion was reported and not disputed.',
    ),
    receiptNext: localized(
      'predmet stoji kao riješen ako dovršetak nitko ne ospori.',
      'il caso risulta risolto se nessuno contesta il completamento.',
      'the case stands resolved if nobody disputes the completion.',
    ),
  },

  /*
   * The six states of the ledger, in the ledger's own words. Four of them stand
   * on the path itself — Zaprimljeno, Dodijeljeno, Odgovoreno, Riješeno — while
   * Osporeno turns the case back toward Odgovoreno and Zatvoreno leaves the path
   * before an answer. Each one carries one sentence; where the path already has
   * the sentence, the strip reuses it rather than writing a second one.
   */
  stateStrip: {
    heading: localized('Put predmeta', 'Percorso del caso', 'The path of the case'),
    // HR draft: native editor review
    branchLabel: localized('Odvojak', 'Ramo', 'Branch'),
    // HR draft: native editor review
    disputedNow: localized(
      'Podnositelj je osporio dovršetak, pa se predmet vraća na Odgovoreno.',
      'Chi ha segnalato ha contestato il completamento, quindi il caso torna a Risposto.',
      'The filer disputed the completion, so the case goes back to Answered.',
    ),
    // HR draft: native editor review
    disputedNext: localized(
      'podnositelj može osporiti dovršetak i predmet se vraća na Odgovoreno.',
      'chi ha segnalato può contestare il completamento e il caso torna a Risposto.',
      'the filer can dispute the completion and the case goes back to Answered.',
    ),
    // HR draft: native editor review
    disputedBack: localized(
      'Vraća predmet na: Odgovoreno',
      'Riporta il caso a: Risposto',
      'Sends the case back to: Answered',
    ),
    // HR draft: native editor review
    closedNow: localized(
      'Predmet je zatvoren uz javno naveden razlog i ne ide dalje putem.',
      'Il caso è chiuso con una motivazione pubblica e non prosegue lungo il percorso.',
      'The case is closed with a public reason and goes no further along the path.',
    ),
    // HR draft: native editor review
    closedNext: localized(
      'ured može predmet zatvoriti uz javno naveden razlog prije nego što odgovori.',
      'l’ufficio può chiudere il caso con una motivazione pubblica prima di rispondere.',
      'the office can close the case with a public reason before it answers.',
    ),
    // HR draft: native editor review
    closedFrom: localized(
      'Odvojak od: Zaprimljeno ili Dodijeljeno',
      'Ramo da: Ricevuto o Assegnato',
      'Branch from: Received or Assigned',
    ),
  },

  /* The office's answer, signed, and what it reported doing. */
  answer: {
    heading: localized('Odgovor općine', 'La risposta del comune', 'The municipality’s answer'),
    commitment: localized('Obveza', 'Impegno', 'Commitment'),
    dueDate: localized('Rok', 'Termine', 'Due'),
    signedBy: localized('Potpisuje', 'Firma', 'Signed by'),
    publishedAt: localized('Objavljeno', 'Pubblicato', 'Published'),
    resolvedAt: localized('Prijavljen dovršetak', 'Completamento dichiarato', 'Completion reported'),
    note: localized(
      'Obveza je javna od objave. Ured je ne može tiho promijeniti.',
      'L’impegno è pubblico dalla pubblicazione. L’ufficio non può modificarlo in silenzio.',
      'The commitment is public from the moment it published. The office cannot change it quietly.',
    ),
    doneHeading: localized('Što je učinjeno', 'Che cosa è stato fatto', 'What was done'),
    evidenceLinks: localized('Dokazi', 'Prove', 'Evidence'),
    // HR draft: native editor review
    webNoContact: localized(
      'Prijava je podnesena webom bez kontakta. Ured ne šalje obavijesti; podnositelj prati predmet na ovoj stranici ili svojom poveznicom.',
      'La segnalazione è stata inviata dal web senza contatto. L’ufficio non invia avvisi; chi ha segnalato segue il caso su questa pagina o con il proprio link.',
      'The report was filed on the web with no contact. The office sends no notifications; the filer follows the case on this page or through their own link.',
    ),
    unit: localized('Odsjek', 'Sezione', 'Section'),
  },

  /* The public check on a completion claim: the count, the disputes, the form. */
  check: {
    heading: localized('Provjera dovršetka', 'Controllo del completamento', 'Checking the completion'),
    notFixedCount: localized('Nije popravljeno', 'Non riparato', 'Not fixed'),
    notFixedAdd: localized('Nije popravljeno', 'Non è riparato', 'It is not fixed'),
    disputesHeading: localized('Osporavanja', 'Contestazioni', 'Disputes'),
    disputeHeld: localized(
      'Tekst osporavanja je zadržan.',
      'Il testo della contestazione è trattenuto.',
      'The text of this dispute is held.',
    ),
    disputeHeading: localized('Osporite dovršetak', 'Contesta il completamento', 'Dispute the completion'),
    disputeIntro: localized(
      'Ako problem stoji, napišite što još ne valja. Tekst je javan uz predmet.',
      'Se il problema resta, scrivi che cosa non va ancora. Il testo è pubblico accanto al caso.',
      'If the problem stands, write what is still wrong. The text is public next to the case.',
    ),
    disputeLabel: localized('Što još ne valja?', 'Che cosa non va ancora?', 'What is still wrong?'),
    disputeSubmit: localized('Objavi osporavanje', 'Pubblica la contestazione', 'Publish the dispute'),
    disputeRequired: localized('Napišite što još ne valja.', 'Scrivi che cosa non va ancora.', 'Write what is still wrong.'),
    disputeSent: localized('Osporavanje je objavljeno.', 'La contestazione è pubblicata.', 'The dispute is published.'),
    disputeFailed: localized(
      'Osporavanje nije spremljeno. Pokušajte ponovno.',
      'La contestazione non è stata salvata. Riprova.',
      'The dispute was not saved. Try again.',
    ),
    disputeLimit: localized(
      'Na ovom su predmetu iskorištena tri osporavanja.',
      'Su questo caso sono state usate tre contestazioni.',
      'This case has used its three disputes.',
    ),
  },

  verification: {
    heading: localized('Provjera', 'Verifica', 'Verification'),
    note: localized(
      'Zapisi ispod nastaju redom i svaki nosi otisak prethodnoga. Otisak potvrde vrijedi za cijeli lanac.',
      'I record qui sotto nascono in ordine e ognuno porta l’impronta del precedente. L’impronta della ricevuta vale per tutta la catena.',
      'The records below are written in order and each carries the fingerprint of the one before it. The receipt hash covers the whole chain.',
    ),
    events: localized('Zapisi predmeta', 'Record del caso', 'Case records'),
    // HR draft: native editor review
    eventHash: localized('Otisak zapisa', 'Impronta del record', 'Record hash'),
    // HR draft: native editor review
    previousHash: localized('Otisak prethodnog zapisa', 'Impronta del record precedente', 'Previous record hash'),
    // HR draft: native editor review
    chainStart: localized(
      'Prvi zapis u lancu: prethodnika nema.',
      'Primo record della catena: non ha un precedente.',
      'First record in the chain: it has no predecessor.',
    ),
    // HR draft: native editor review
    hashOpen: localized('Cijeli otisak', 'Impronta completa', 'Full hash'),
    // HR draft: native editor review
    textHash: localized(
      'Otisak teksta kako je zaprimljen',
      'Impronta del testo come ricevuto',
      'Hash of the text as filed',
    ),
    // HR draft: native editor review
    textHashLegacy: localized(
      'Stariji zapis: otisak je izračunat nad normaliziranim tekstom, ne nad tekstom kako je zaprimljen.',
      'Record più vecchio: l’impronta è calcolata sul testo normalizzato, non sul testo come ricevuto.',
      'Older record: the hash is over the normalised text, not over the text as filed.',
    ),
    // HR draft: native editor review
    lastEventHash: localized('Otisak posljednjeg zapisa', 'Impronta dell’ultimo record', 'Last record hash'),
    // HR draft: native editor review
    eventsEmpty: localized(
      'Zapisi se objavljuju uz odgovor ureda.',
      'I record vengono pubblicati insieme alla risposta dell’ufficio.',
      'The records publish together with the office answer.',
    ),
  },

  /**
   * Reviewed stamps for the public case shell. They are meaning labels, not
   * descriptions: never paraphrase them, change them only here.
   */
  state: {
    received: localized('ZAPRIMLJENO', 'RICEVUTO', 'RECEIVED'),
    assigned: localized('DODIJELJENO', 'ASSEGNATO', 'ASSIGNED'),
    answered: localized('ODGOVORENO', 'RISPOSTO', 'ANSWERED'),
    resolved: localized('RIJEŠENO', 'RISOLTO', 'RESOLVED'),
    disputed: localized('OSPORENO', 'CONTESTATO', 'DISPUTED'),
    closed: localized('ZATVORENO', 'CHIUSO', 'CLOSED'),
  } as Readonly<Record<string, LocalizedText>>,

  /** The text-visibility stamp, which is not a process state. */
  textState: {
    held: localized('ZADRŽANO', 'TRATTENUTO', 'HELD'),
    redacted: localized('SKRAĆENO', 'RIDOTTO', 'REDACTED'),
  } as Readonly<Record<string, LocalizedText>>,

  attention: {
    heading: localized('Pozornost javnosti', 'Attenzione pubblica', 'Public attention'),
    alsoAffectedCount: localized('Isti problem', 'Stesso problema', 'Same problem'),
    alsoAffectedAdd: localized('Imam isti problem', 'Ho lo stesso problema', 'I have the same problem'),
    followCount: localized('Prati', 'Segui', 'Follow'),
    followAdd: localized('Prati', 'Segui', 'Follow'),
    notFixedCount: localized('Nije popravljeno', 'Non riparato', 'Not fixed'),
    notFixedAdd: localized('Nije popravljeno', 'Non è riparato', 'It is not fixed'),
    notFixedWhen: localized(
      'Oznaka stoji dok ured drži da je dovršeno.',
      'Il segnale è disponibile finché l’ufficio considera il caso completato.',
      'The mark is open while the office holds the case complete.',
    ),
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

/** The plain reason a held text gives, or the catch-all when none is named. */
export function translatedHoldReason(reason: unknown, lang: PilotLang): string {
  const key = typeof reason === 'string' ? reason : '';
  return publicCaseCopy.holdReason[key]?.[lang] ?? publicCaseCopy.holdReason.other[lang];
}

/** Why a text is gone: the filer asked, or the retention period ran out. */
export function translatedRemovedReason(reason: unknown, lang: PilotLang): string {
  return reason === 'retention'
    ? publicCaseCopy.removed.retention[lang]
    : publicCaseCopy.removed.filer[lang];
}

/** The same removal, said as one line in the public trail. */
export function translatedTextRemoved(reason: unknown, lang: PilotLang): string {
  return reason === 'retention'
    ? publicCaseCopy.trail.textRemovedRetention[lang]
    : publicCaseCopy.trail.textRemovedFiler[lang];
}

/** The confidential officer of the municipality, named in one line. */
export function confidentialContactLine(
  contact: { name: string; email: string; phone: string },
  lang: PilotLang,
): string {
  return publicCaseCopy.confidential.contact[lang]
    .replace('{name}', contact.name)
    .replace('{email}', contact.email)
    .replace('{phone}', contact.phone);
}

/**
 * The word carries the state; the tone only reinforces it (rule P4). A closed
 * shell stays neutral: closure is an outcome, not a failure.
 */
const caseStateTones: Readonly<Record<string, string>> = Object.freeze({
  received: 'trace',
  assigned: 'warning',
  answered: 'valid',
  resolved: 'valid',
  disputed: 'warning',
  closed: 'unknown',
});

export function caseStateTone(state: unknown): string {
  const key = typeof state === 'string' ? state : '';
  return caseStateTones[key] ?? 'unknown';
}

/** The first sentences of a report, for a ledger row. Never mid-word. */
export function textExcerpt(value: unknown, limit = 140): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
