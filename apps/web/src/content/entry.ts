// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Entry-flow strings: the place map (S1) and the intent screen (S2).
 *
 * PENDING NATIVE-EDITOR REVIEW. Croatian is the source language and every line
 * here is a build placeholder taken from the entry-flow spec and the HR
 * glossary. A native editor confirms each label before release (entry-flow
 * R11); English is the second language and follows whatever Croatian settles on.
 */

import type { LocalizedText } from './public-release';

export const entryStrings = {
  /** S1 · the map */
  question: { hr: 'Gdje ste?', en: 'Where are you?' },
  mapLabel: { hr: 'Karta Hrvatske po županijama', en: 'Map of Croatia by county' },
  regionLabel: { hr: 'Županija', en: 'County' },
  regionPlaceholder: { hr: 'Odaberite županiju', en: 'Choose a county' },
  regionSubmit: { hr: 'Prikaži', en: 'Show' },
  wholeCountry: { hr: 'Cijela Hrvatska', en: 'All of Croatia' },
  locate: { hr: 'Moja lokacija', en: 'Use my location' },
  locating: { hr: 'Tražim vašu lokaciju…', en: 'Finding your location…' },
  pickOnMap: { hr: 'Odaberite mjesto na karti.', en: 'Pick a place on the map.' },
  notHereYet: { hr: 'Još nije ovdje.', en: 'Not here yet.' },
  searchLabel: { hr: 'Potražite mjesto', en: 'Search for a place' },
  searchPlaceholder: { hr: 'Ime mjesta', en: 'Place name' },
  searchNoResults: { hr: 'Nema rezultata.', en: 'No matches.' },
  countyPlaces: { hr: 'Mjesta u županiji', en: 'Places in this county' },

  /** S2 · intent */
  backToMap: { hr: '← Karta', en: '← Map' },
  record: { hr: 'Javni zapis', en: 'Public record' },
  recordNote: { hr: 'Svi predmeti, u svakom stanju.', en: 'Every case, in every state.' },
  report: { hr: 'Prijavite problem', en: 'Report a problem' },
  reportNote: {
    hr: 'Bez računa. Dobit ćete broj predmeta.',
    en: 'No account. You get a case number.',
  },

  /** S3 · the place ledger */
  ledgerTitle: { hr: 'Javni zapis', en: 'Public record' },
  ledgerOpen: { hr: 'Otvoreno', en: 'Open' },
  ledgerOverdue: { hr: 'Rok prekoračen', en: 'Past due' },
  ledgerClosed: { hr: 'Zatvoreno', en: 'Closed' },
  /* Held text is not a process state, so it is counted next to the states. */
  ledgerHeld: { hr: 'Zadržan tekst', en: 'Text held' },

  /*
   * The list arrives in pages of fifty. The counts above it are the whole
   * municipality, so the line beside the button says how much of it is on
   * screen instead of leaving the reader to guess.
   */
  // HR draft: native editor review
  ledgerMore: { hr: 'Prikaži još', en: 'Show more' },
  // HR draft: native editor review
  ledgerMoreLoading: { hr: 'Učitavanje…', en: 'Loading…' },
  // HR draft: native editor review
  ledgerShown: { hr: 'Prikazano {n} od {total}', en: 'Showing {n} of {total}' },

  /*
   * The stage chips. The labels are the same reviewed words the status stamp on
   * a row carries, in lower case, so a chip and a stamp never read as two
   * different things.
   */
  ledgerStageLegend: { hr: 'Faza postupka', en: 'Stage of the process' },
  ledgerStageAll: { hr: 'Sve', en: 'All' },
  ledgerStageReceived: { hr: 'Zaprimljeno', en: 'Received' },
  ledgerStageAssigned: { hr: 'Dodijeljeno', en: 'Assigned' },
  ledgerStageAnswered: { hr: 'Odgovoreno', en: 'Answered' },
  ledgerStageResolved: { hr: 'Riješeno', en: 'Resolved' },
  ledgerStageDisputed: { hr: 'Osporeno', en: 'Disputed' },
  ledgerStageClosed: { hr: 'Zatvoreno', en: 'Closed' },
  ledgerStageEmpty: { hr: 'Nema predmeta u ovoj fazi.', en: 'No cases at this stage.' },
  ledgerStageEmptyAll: { hr: 'Prikaži sve predmete', en: 'Show every case' },

  /* One line under a row that has reached an answer. */
  ledgerHintAnswered: { hr: 'Ured je objavio obvezu.', en: 'The office published its commitment.' },
  ledgerHintResolved: { hr: 'Riješeno', en: 'Resolved' },
  ledgerHintDisputed: {
    hr: 'Podnositelj je osporio dovršetak.',
    en: 'The filer disputed the completion.',
  },
  ledgerHintOverdue: { hr: 'Rok prekoračen', en: 'Past due' },
  ledgerSearchLabel: { hr: 'Broj predmeta', en: 'Case number' },
  ledgerSearchPlaceholder: { hr: 'VRS-123456', en: 'VRS-123456' },
  ledgerSearchSubmit: { hr: 'Otvori', en: 'Open' },
  ledgerSearchInvalid: {
    hr: 'Broj predmeta ima oblik VRS-123456.',
    en: 'A case number has the form VRS-123456.',
  },
  ledgerFiled: { hr: 'Podneseno', en: 'Filed' },
  ledgerDue: { hr: 'Rok', en: 'Due' },
  ledgerFollowers: { hr: 'Prati', en: 'Following' },
  ledgerAlsoAffected: { hr: 'Isti problem', en: 'Same problem' },
  ledgerNotFixed: { hr: 'Nije popravljeno', en: 'Not fixed' },
  /* A row whose text the office is holding says so where the text would stand. */
  ledgerTextHeld: { hr: 'Tekst je zadržan.', en: 'The text is held.' },
  /*
   * Two more text outcomes a row can carry: a text the office has not published
   * yet, and a text that is gone. Both are stated in words, never as a blank.
   */
  ledgerPendingRelease: { hr: 'Čeka objavu', en: 'Awaiting publication' },
  ledgerRemoved: { hr: 'Uklonjeno', en: 'Removed' },
  ledgerTextPending: {
    hr: 'Tekst čeka objavu ureda.',
    en: 'The text is waiting for the office to publish it.',
  },
  ledgerTextRemovedFiler: {
    hr: 'Tekst uklonjen na zahtjev podnositelja.',
    en: 'The text was removed at the filer’s request.',
  },
  ledgerTextRemovedRetention: {
    hr: 'Tekst uklonjen nakon isteka roka čuvanja.',
    en: 'The text was removed after the retention period ended.',
  },
  ledgerEmpty: { hr: 'Još nema predmeta.', en: 'No cases yet.' },
  ledgerEmptyPurpose: {
    hr: 'Ovdje stoji svaki predmet ove općine, u svakom stanju, čim ga ured zaprimi.',
    en: 'Every case of this municipality stands here, in every state, from the moment the office receives it.',
  },
  ledgerError: { hr: 'Zapis trenutno nije dostupan.', en: 'The record is unavailable right now.' },
  ledgerRetry: { hr: 'Pokušajte ponovno', en: 'Try again' },
  ledgerLoading: { hr: 'Učitavanje predmeta…', en: 'Loading cases…' },
  ledgerNotAVote: {
    hr: 'Broj pratitelja nije glasovanje i ne mijenja redoslijed.',
    en: 'The follower count is not a vote and does not change the order.',
  },

  /** The public case page under a place */
  caseBack: { hr: '← Javni zapis', en: '← Public record' },
  caseKeyLine: {
    hr: 'Ovo je vaša poveznica s ključem za ponovno otvaranje. Sačuvajte je.',
    en: 'This is your link with the reopen key. Keep it.',
  },
  copyLink: { hr: 'Kopiraj poveznicu', en: 'Copy link' },
  copy: { hr: 'Kopiraj', en: 'Copy' },
  copied: { hr: 'Kopirano', en: 'Copied' },

  /** S4 · filing */
  reportMapLabel: {
    hr: 'Karta ulica za odabir lokacije problema',
    en: 'Street map for choosing the problem location',
  },
  reportMapCaption: {
    hr: 'Dodirnite ili kliknite kartu gdje je problem. Tipkovnica: strelice pomiču kartu, Enter ili razmaknica odabire središte.',
    en: 'Tap or click the map where the problem is. Keyboard: use the arrow keys to pan, then Enter or Space to choose the centre.',
  },
  reportMapAttribution: {
    hr: '© OpenStreetMap suradnici',
    en: '© OpenStreetMap contributors',
  },
  // HR draft: native editor review
  reportMapOpen: { hr: 'Otvori kartu', en: 'Open the map' },
  reportMapConfirm: { hr: 'Potvrdi lokaciju', en: 'Confirm location' },
  reportMapClose: { hr: 'Zatvori', en: 'Close' },
  // HR draft: native editor review
  reportMapRemove: { hr: 'Izbriši lokaciju', en: 'Remove location' },
  // HR draft: native editor review
  reportMapRemoveShort: { hr: 'Izbriši', en: 'Remove' },
  reportMapAccuracy: { hr: 'Točnost oko {metres} m.', en: 'Accuracy about {metres} m.' },
  reportMapInsecure: {
    hr: 'Lokacija radi samo preko sigurne veze. Odaberite točku na karti ili opišite mjesto.',
    en: 'Location works only over a secure connection. Choose a point on the map or describe the place.',
  },
  reportMapSelected: { hr: 'Odabrana lokacija:', en: 'Selected location:' },
  reportMapCleared: { hr: 'Lokacija je uklonjena.', en: 'The location was cleared.' },
  reportMapMarkerLabel: { hr: 'Odabrana lokacija', en: 'Selected location' },
  reportMapZoomIn: { hr: 'Povećaj kartu', en: 'Zoom in' },
  reportMapZoomOut: { hr: 'Smanji kartu', en: 'Zoom out' },
  reportMapUnavailable: {
    hr: 'Karta trenutačno nije dostupna. Opišite lokaciju u polju ispod.',
    en: 'The map is unavailable. Describe the location below.',
  },
  reportMapLocationDenied: {
    hr: 'Pristup lokaciji nije dopušten. Odaberite točku na karti ili opišite lokaciju ispod.',
    en: 'Location access was denied. Choose a point on the map or describe the location below.',
  },
  reportMapLocationError: {
    hr: 'Vašu lokaciju nije moguće odrediti. Odaberite točku na karti ili opišite lokaciju ispod.',
    en: 'Your location could not be found. Choose a point on the map or describe the location below.',
  },
  reportMapPrivacy: {
    hr: 'Karta ulica učitava pločice izravno s OpenStreetMapa. OpenStreetMap prima vašu IP adresu i prikazano područje karte, ali ne tekst prijave ni fotografiju.',
    en: 'The street map loads tiles directly from OpenStreetMap. OpenStreetMap receives your IP address and the map area shown, but not your report text or photo.',
  },
  reportTextLabel: { hr: 'Što se dogodilo?', en: 'What happened?' },
  reportTextRequired: { hr: 'Napišite što se dogodilo.', en: 'Write what happened.' },
  reportCharsLeft: { hr: 'Preostalo znakova:', en: 'Characters left:' },
  reportWhereLabel: { hr: 'Gdje točno?', en: 'Where exactly?' },
  reportWherePlaceholder: {
    hr: 'npr. Stup 14, kod pekare',
    en: 'e.g. Lamp post 14, by the bakery',
  },
  // HR draft: native editor review
  reportPhotoCapture: { hr: 'Fotografiraj', en: 'Take a photo' },
  reportPhotoCaptureHint: { hr: 'Otvori kameru', en: 'Open the camera' },
  reportPhotoUpload: { hr: 'Učitaj sliku', en: 'Upload a photo' },
  reportPhotoUploadHint: { hr: 'Iz galerije uređaja', en: 'From your gallery' },
  reportPhotoRemove: { hr: 'Ukloni', en: 'Remove' },
  reportPhotoWorking: { hr: 'Obrađujem fotografiju…', en: 'Preparing photo…' },
  reportPhotoAlt: { hr: 'Odabrana fotografija', en: 'The selected photo' },
  reportPhotoTooLarge: {
    hr: 'Fotografija je prevelika. Pokušajte s manjom.',
    en: 'The photo is too large. Try a smaller one.',
  },
  reportPhotoUnreadable: {
    hr: 'Fotografiju nije moguće pripremiti. Pošaljite prijavu bez nje.',
    en: 'The photo could not be prepared. Send the report without it.',
  },
  /*
   * Says the two things a person needs before they attach a photo: it is not
   * published, and the phone's location and device data are dropped because the
   * browser re-encodes the picture before it leaves the phone.
   */
  reportPhotoNote: {
    hr: 'Jedna fotografija, neobavezno. Zasad je vidi samo ured i ne objavljuje se. Lokacija i podaci fotoaparata brišu se prije slanja.',
    en: 'One photo, optional. For now only the office sees it and it is not published. The location and camera data are stripped before it is sent.',
  },
  reportSubmit: { hr: 'Pošalji prijavu', en: 'Send report' },
  reportSending: { hr: 'Šaljem…', en: 'Sending…' },
  /*
   * The filing note is composed on the page, one sentence per thing a filer has
   * to know: what this municipality publishes and when, who the controller is,
   * what stays private, how long the report is kept, and how rights are used.
   * The warning below is the part a person can act on before they write.
   */
  reportPrivacyNote: {
    hr: 'Bez računa. Ne pišite imena, brojeve telefona ni registracije drugih ljudi.',
    en: 'No account. Do not write other people’s names, phone numbers or plates.',
  },
  reportPrivacyOpen: {
    hr: 'Tekst i lokaciju objavljujemo odmah, pod brojem predmeta.',
    en: 'We publish the text and the location right away, under the case number.',
  },
  reportPrivacyRelease: {
    hr: 'Tekst i lokaciju objavljuje ured nakon provjere. Broj predmeta javan je odmah.',
    en: 'The office publishes the text and the location after a check. The case number is public right away.',
  },
  reportPrivacyShell: {
    hr: 'Tekst i lokaciju ne objavljujemo. Javno je stanje predmeta i otisak izvornog teksta.',
    en: 'We do not publish the text or the location. The case state and the fingerprint of the original text are public.',
  },
  reportPrivacyController: {
    hr: 'Voditelj obrade je {controller}, {address}.',
    en: 'The controller is {controller}, {address}.',
  },
  reportPrivacyPrivate: {
    hr: 'Vaši kontaktni podaci i fotografija ostaju privatni.',
    en: 'Your contact details and photo stay private.',
  },
  reportPrivacyRetention: {
    hr: 'Prijavu čuvamo {days} dana.',
    en: 'We keep the report for {days} days.',
  },
  reportPrivacyRights: {
    hr: 'Imate pravo na pristup, brisanje i prigovor. Ostvarujete ih brojem predmeta i ključem iz svoje poveznice; bez njega prijavu ne možemo povezati s vama.',
    en: 'You have the right of access, erasure and objection. You use them with the case number and the key in your link; without it we cannot connect the report to you.',
  },
  reportPrivacyDpo: {
    hr: 'Službenik za zaštitu podataka: {email}.',
    en: 'Data protection officer: {email}.',
  },
  reportPrivacyLink: {
    hr: 'Cijela obavijest o zaštiti podataka',
    en: 'The full data protection notice',
  },
  reportFailed: {
    hr: 'Prijava nije poslana. Pokušajte ponovno.',
    en: 'The report was not sent. Try again.',
  },
  reportNoScript: {
    hr: 'Za slanje je potreban JavaScript ili pošaljite SMS na broj općine.',
    en: 'Sending needs JavaScript, or send an SMS to the municipality number.',
  },

  /** S5 · the case number */
  caseNumberTitle: { hr: 'Vaš broj predmeta', en: 'Your case number' },
  caseLinkTitle: { hr: 'Vaša poveznica', en: 'Your link' },
  caseKeyNote: {
    hr: 'S ovom poveznicom možete kasnije dopuniti ili povući prijavu. Bez nje to nije moguće.',
    en: 'With this link you can add to or withdraw the report later. Without it you cannot.',
  },
  caseOpenRecord: { hr: 'Otvori javni zapis predmeta', en: 'Open the public case record' },
  /*
   * Croatian puts the place name in the accusative after "na", which the place
   * list cannot produce from the nominative. One live place, one line; a second
   * live place needs its own form from the native editor.
   */
  caseBackToPlace: { hr: 'Natrag na Općinu Vrsar', en: 'Back to Vrsar Municipality' },

  /*
   * S5 · what happened to the text. The screen paints the number without a
   * request; this block is filled after the public shell answers, and only when
   * the shell says the text is not public. Public text needs no explanation.
   */
  caseOutcomeConfidentialHeading: {
    hr: 'Prijava je upućena povjerljivoj osobi',
    en: 'The report went to the confidential officer',
  },
  caseOutcomeConfidentialNote: {
    hr: 'Zbog sadržaja prijave tekst se ne objavljuje. Javite se povjerljivoj osobi općine.',
    en: 'Because of what the report says, the text is not published. Contact the municipality’s confidential officer.',
  },
  caseOutcomePendingRelease: {
    hr: 'Tekst čeka objavu ureda. Broj predmeta javan je odmah.',
    en: 'The text is waiting for the office to publish it. The case number is public right away.',
  },
  caseOutcomePolicy: {
    hr: 'Ova općina ne objavljuje tekst prijave. Javno je stanje predmeta i otisak teksta.',
    en: 'This municipality does not publish report text. The case state and the fingerprint of the text are public.',
  },
  caseOutcomeHeld: {
    hr: 'Tekst je zadržan. Razlog je javno naveden na zapisu predmeta.',
    en: 'The text is held. The reason is stated publicly on the case record.',
  },
  /* Who acts next, for a hold nobody but the office can lift. */
  caseOutcomeOfficeDecides: {
    hr: 'O objavi teksta odlučuje ured.',
    en: 'The office decides whether the text is published.',
  },

  /*
   * The Article 13 notice under a place. One sentence per section; the mode
   * decides which "what is public" line the page prints.
   */
  privacyHeading: { hr: 'Obavijest o zaštiti osobnih podataka', en: 'Data protection notice' },
  privacyControllerTitle: { hr: 'Voditelj obrade', en: 'Controller' },
  privacyController: {
    hr: 'Voditelj obrade vaših podataka je {controller}, {address}. Polis vodi Intrface j.d.o.o. kao izvršitelj obrade, po uputi općine.',
    en: 'The controller of your data is {controller}, {address}. Intrface j.d.o.o. runs Polis as processor, on the municipality’s instructions.',
  },
  privacyPurposeTitle: { hr: 'Svrha obrade', en: 'Purpose' },
  privacyPurpose: {
    hr: 'Zaprimanje prijave, postupanje po njoj i javni prikaz onoga što je općina učinila.',
    en: 'To take in the report, act on it, and show in public what the municipality did.',
  },
  privacyLegalBasisTitle: { hr: 'Pravna osnova', en: 'Legal basis' },
  privacyLegalBasis: {
    hr: 'Obrada je nužna za izvršavanje zadaće od javnog interesa, članak 6. stavak 1. točka e Opće uredbe o zaštiti podataka.',
    en: 'Processing is necessary for a task carried out in the public interest, Article 6(1)(e) of the General Data Protection Regulation.',
  },
  privacyWhatIsPublicTitle: { hr: 'Što je javno', en: 'What is public' },
  privacyWhatIsPublicOpen: {
    hr: 'Broj predmeta, tekst prijave i lokacija javni su od trenutka podnošenja, uz stanje predmeta, rok i odgovor ureda.',
    en: 'The case number, the report text and the location are public from the moment of filing, with the case state, the due date and the office’s answer.',
  },
  privacyWhatIsPublicRelease: {
    hr: 'Broj predmeta, stanje predmeta, rok i odgovor ureda javni su odmah. Tekst prijave i lokaciju objavljuje ured nakon provjere.',
    en: 'The case number, the case state, the due date and the office’s answer are public right away. The office publishes the report text and the location after a check.',
  },
  privacyWhatIsPublicShell: {
    hr: 'Javni su broj predmeta, stanje predmeta, rok, odgovor ureda i otisak izvornog teksta. Tekst prijave i lokacija nisu javni.',
    en: 'The case number, the case state, the due date, the office’s answer and the fingerprint of the original text are public. The report text and the location are not.',
  },
  privacyWhatStaysPrivateTitle: { hr: 'Što ostaje privatno', en: 'What stays private' },
  privacyWhatStaysPrivate: {
    hr: 'Kontaktni podaci, fotografija i prepiska s uredom nisu javni. Vidi ih ured, a vi ključem iz svoje poveznice.',
    en: 'Contact details, the photo and messages with the office are not public. The office sees them, and so do you, with the key in your link.',
  },
  privacyRetentionTitle: { hr: 'Rok čuvanja', en: 'Retention' },
  privacyRetention: {
    hr: 'Tekst prijave i lokaciju uklanjamo {days} dana nakon zatvaranja predmeta.',
    en: 'We remove the report text and the location {days} days after the case is closed.',
  },
  privacyHashStays: {
    hr: 'Otisak izvornog teksta ostaje javan i nakon uklanjanja teksta, da zapis ostane provjerljiv.',
    en: 'The fingerprint of the original text stays public after the text is removed, so the record stays checkable.',
  },
  privacyRightsTitle: { hr: 'Vaša prava', en: 'Your rights' },
  privacyRights: {
    hr: 'Imate pravo na pristup, brisanje i prigovor. Ostvarujete ih brojem predmeta i ključem iz svoje poveznice; bez njega prijavu ne možemo povezati s vama.',
    en: 'You have the right of access, erasure and objection. You use them with the case number and the key in your link; without it we cannot connect the report to you.',
  },
  privacyDpoTitle: { hr: 'Službenik za zaštitu podataka', en: 'Data protection officer' },
  privacyDpo: {
    hr: 'Službenik za zaštitu podataka: {email}.',
    en: 'Data protection officer: {email}.',
  },
  privacyConfidentialTitle: { hr: 'Povjerljiva osoba', en: 'Confidential officer' },
  privacyConfidential: {
    hr: 'Za prijavu nepravilnosti obratite se povjerljivoj osobi općine. Polis nije kanal za zaštićeno unutarnje prijavljivanje.',
    en: 'For a report of wrongdoing, contact the municipality’s confidential officer. Polis is not a channel for protected internal reporting.',
  },
  privacyComplaintTitle: { hr: 'Pritužba', en: 'Complaint' },
  privacyComplaint: {
    hr: 'Pritužbu možete podnijeti Agenciji za zaštitu osobnih podataka (AZOP).',
    en: 'You can lodge a complaint with the Croatian Personal Data Protection Agency (AZOP).',
  },

  /** chrome */
  attribution: {
    hr: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
    en: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
  },
  /*
   * The entry footer, two links: the company that runs Polis, then the page
   * that says what Polis is. The per-municipality privacy notice is not here —
   * it belongs to the place, and the filing form links to it directly.
   */
  footerIntrface: { hr: 'Intrface', en: 'Intrface' },
  /* The studio's own mark, shown in the footer of "What is Polis?" only. */
  footerIntrfaceBrand: { hr: 'INTRFACE', en: 'INTRFACE' },
  footerAbout: { hr: 'Što je Polis?', en: 'What is Polis?' },
  /*
   * The band a hosted test build carries on every entry page. It names the
   * instance, the data and the fact that the municipality does not answer here,
   * so nobody mistakes a test link for the real channel.
   */
  testInstance: {
    hr: 'Testna instanca. Podaci su sintetički. Ovo nije službeni kanal Općine Vrsar.',
    en: 'Test instance. Data is synthetic. This is not an official channel of Općina Vrsar.',
  },
  /** Same band, one link: the office side of the test instance is one tap away. */
  testInstanceStaff: {
    hr: 'Za općinu: prijava',
    en: 'For the municipality: sign in',
  },
} satisfies Record<string, LocalizedText>;

/** Page titles and meta descriptions, one line each, no marketing. */
export const entryMeta = {
  mapTitle: { hr: 'Polis — Gdje ste?', en: 'Polis — Where are you?' },
  mapDescription: {
    hr: 'Odaberite svoje mjesto na karti Hrvatske i otvorite javni zapis ili prijavite problem.',
    en: 'Pick your place on the map of Croatia, then open the public record or report a problem.',
  },
  placeDescription: {
    hr: 'Javni zapis predmeta i prijava problema za vaše mjesto.',
    en: 'The public case record and problem reporting for your place.',
  },
  ledgerTitle: { hr: 'Polis — Javni zapis', en: 'Polis — Public record' },
  ledgerDescription: {
    hr: 'Svi predmeti ove općine, u svakom stanju, s rokom i pozornošću javnosti.',
    en: 'Every case of this municipality, in every state, with its due date and public attention.',
  },
  caseDescription: {
    hr: 'Stanje jednog predmeta, rok i pozornost javnosti.',
    en: 'The state of one case, its due date and public attention.',
  },
  reportTitle: { hr: 'Polis — Prijavite problem', en: 'Polis — Report a problem' },
  reportDescription: {
    hr: 'Prijavite problem bez računa. Dobit ćete broj predmeta i poveznicu.',
    en: 'Report a problem without an account. You get a case number and a link.',
  },
  caseNumberTitle: { hr: 'Polis — Vaš broj predmeta', en: 'Polis — Your case number' },
  caseNumberDescription: {
    hr: 'Broj predmeta i poveznica s ključem za ponovno otvaranje.',
    en: 'The case number and the link that carries the reopen key.',
  },
  privacyDescription: {
    hr: 'Tko obrađuje vašu prijavu, što je javno, koliko se čuva i kako ostvarujete svoja prava.',
    en: 'Who processes your report, what is public, how long it is kept, and how you use your rights.',
  },
} satisfies Record<string, LocalizedText>;
