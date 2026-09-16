// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const PILOT_LANGS = ['hr', 'it', 'en'] as const;
export type PilotLang = (typeof PILOT_LANGS)[number];
export type LocalizedText = Readonly<Record<PilotLang, string>>;

const localized = (hr: string, it: string, en: string): LocalizedText => Object.freeze({ hr, it, en });

export function parsePilotLang(url: URL): PilotLang {
  const candidate = url.searchParams.get('lang');
  return candidate === 'it' || candidate === 'en' ? candidate : 'hr';
}

export function pilotHref(path: string, lang: PilotLang): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}lang=${lang}`;
}

export function pickLocalized(value: unknown, lang: PilotLang, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return fallback;
  const labels = value as Partial<Record<PilotLang, unknown>> & { label?: unknown; name?: unknown };
  for (const key of [lang, 'hr', 'it', 'en'] as const) {
    if (typeof labels[key] === 'string' && labels[key]) return labels[key];
  }
  if (typeof labels.label === 'string') return labels.label;
  if (typeof labels.name === 'string') return labels.name;
  return fallback;
}

export const pilotCopy = Object.freeze({
  productName: 'Polis',
  appTitle: localized(
    'Neslužbeni testni tijek za Vrsar-Orsera',
    'Flusso di test non ufficiale per Vrsar-Orsera',
    'Unofficial Vrsar-Orsera test workflow',
  ),
  boundary: localized(
    'Neslužbeno testno okruženje. Prihvaća samo sintetičke prijave. Općina Vrsar-Orsera nije odobrila ovu uslugu.',
    'Ambiente di test non ufficiale. Accetta solo segnalazioni sintetiche. Il Comune di Vrsar-Orsera non ha autorizzato questo servizio.',
    'Unofficial test environment. Synthetic reports only. The Municipality of Vrsar-Orsera has not authorized this service.',
  ),
  footer: localized(
    'Sintetički podaci · Nije aktivna općinska usluga · Bez službenog grba ili potpore',
    'Dati sintetici · Non è un servizio comunale attivo · Nessuno stemma o patrocinio ufficiale',
    'Synthetic data · Not a live municipal service · No official crest or endorsement',
  ),
  skip: localized('Preskoči na glavni sadržaj', 'Vai al contenuto principale', 'Skip to main content'),
  language: localized('Jezik', 'Lingua', 'Language'),
  nav: {
    home: localized('Početak', 'Inizio', 'Home'),
    file: localized('Nova prijava', 'Nuova segnalazione', 'New report'),
    cases: localized('Moji predmeti', 'I miei casi', 'My cases'),
    staff: localized('Radni red ureda', "Coda dell'ufficio", 'Office queue'),
    receipts: localized('Javne potvrde', 'Ricevute pubbliche', 'Public receipts'),
    login: localized('Prijava', 'Accedi', 'Sign in'),
    logout: localized('Odjava', 'Esci', 'Sign out'),
  },
  common: {
    loading: localized('Učitavanje…', 'Caricamento…', 'Loading…'),
    retry: localized('Pokušaj ponovno', 'Riprova', 'Try again'),
    cancel: localized('Odustani', 'Annulla', 'Cancel'),
    submit: localized('Pošalji', 'Invia', 'Submit'),
    back: localized('Natrag', 'Indietro', 'Back'),
    details: localized('Otvori pojedinosti', 'Apri i dettagli', 'Open details'),
    notAvailable: localized('Podatak nije dostupan.', 'Dato non disponibile.', 'Information unavailable.'),
    dateUnavailable: localized('Datum nije dostupan', 'Data non disponibile', 'Date unavailable'),
    private: localized('Privatno / ograničeno', 'Privato / riservato', 'Private / restricted'),
    public: localized('Javno', 'Pubblico', 'Public'),
    role: localized('Uloga', 'Ruolo', 'Role'),
    municipality: localized('Općina', 'Comune', 'Municipality'),
    office: localized('Nadležni odsjek', 'Ufficio responsabile', 'Responsible office'),
    category: localized('Kategorija', 'Categoria', 'Category'),
    caseNumber: localized('Broj predmeta', 'Numero del caso', 'Case number'),
    recordId: localized('Oznaka zapisa', 'Identificativo del record', 'Record ID'),
    status: localized('Status', 'Stato', 'Status'),
    updated: localized('Ažurirano', 'Aggiornato', 'Updated'),
    created: localized('Podneseno', 'Presentato', 'Filed'),
    version: localized('Verzija', 'Versione', 'Version'),
    noResults: localized('Nema zapisa za prikaz.', 'Nessun record da mostrare.', 'No records to show.'),
    connectionError: localized(
      'Veza s testnim poslužiteljem nije uspjela. Provjerite vezu i pokušajte ponovno.',
      'Connessione al server di test non riuscita. Controlla la connessione e riprova.',
      'Could not reach the test server. Check the connection and try again.',
    ),
    signInRequired: localized(
      'Za ovaj prikaz morate se prijaviti.',
      'Devi accedere per vedere questa pagina.',
      'You must sign in to view this page.',
    ),
    wrongRole: localized(
      'Vaša poslužiteljska uloga nema pristup ovom prikazu.',
      'Il ruolo assegnato dal server non può accedere a questa pagina.',
      'Your server-assigned role cannot access this page.',
    ),
    syntheticOnly: localized(
      'Koristite samo sintetičke testne podatke. Ne unosite stvarne osobe, kontakte ni prijavljene kvarove na stvarnim lokacijama.',
      'Usa solo dati sintetici di prova. Non inserire persone reali, contatti reali o guasti segnalati in luoghi reali.',
      'Use synthetic test data only. Do not enter real people, real contacts, or reported faults at real locations.',
    ),
  },
  entry: {
    heading: localized(
      'Pratite odgovor na sintetičku prijavu javne rasvjete',
      'Segui la risposta a una segnalazione sintetica di illuminazione pubblica',
      'Follow the response to a synthetic public-lighting report',
    ),
    intro: localized(
      'Stanovnik podnosi prijavu i tekst je javan odmah. Konfigurirani odsjek preuzima odgovornost i objavljuje obvezu pod imenom i funkcijom odgovorne osobe. Dovršetak provjerava javnost: podnositelj ga može osporiti.',
      "Il residente presenta una segnalazione e il testo è pubblico subito. L'ufficio configurato assume la responsabilità e pubblica l'impegno con il nome e la funzione della persona responsabile. Il completamento lo verifica il pubblico: chi ha segnalato può contestarlo.",
      'A resident files a report and the text is public at once. The configured office accepts responsibility and publishes a commitment under the name and title of the responsible person. The public checks completion: the filer can dispute it.',
    ),
    sessionChecking: localized('Provjera prijavljene uloge…', 'Verifica del ruolo assegnato…', 'Checking the signed-in role…'),
    signedOut: localized(
      'Niste prijavljeni. Javne potvrde možete čitati bez prijave.',
      'Non hai effettuato l’accesso. Puoi leggere le ricevute pubbliche senza accedere.',
      'You are not signed in. Public receipts remain readable without signing in.',
    ),
    intakeOpen: localized('Testni unos je otvoren.', 'La raccolta di test è aperta.', 'Test intake is open.'),
    intakeClosed: localized(
      'Nove prijave su zatvorene. Postojeći predmeti i javne potvrde ostaju dostupni.',
      'Le nuove segnalazioni sono chiuse. I casi esistenti e le ricevute pubbliche restano disponibili.',
      'New reports are closed. Existing cases and public receipts remain available.',
    ),
    publicationRule: localized(
      'Objavljena obveza nije dokaz izvršenog popravka. Ured prijavljuje dovršetak uz dokaze, a podnositelj ga može osporiti.',
      'Un impegno pubblicato non dimostra che la riparazione sia completata. L’ufficio segnala il completamento con prove e chi ha segnalato può contestarlo.',
      'A published commitment does not prove the repair is complete. The office reports completion with evidence and the filer can dispute it.',
    ),
    runtimeDownTitle: localized(
      'Testni poslužitelj se ne javlja',
      'Il server di test non risponde',
      'The test server is not responding',
    ),
    runtimeDownFix: localized(
      'Pokrenite lokalni testni poslužitelj pa pokušajte ponovno. Javne potvrde ostaju nedostupne dok veza ne proradi.',
      'Avvia il server di test locale e riprova. Le ricevute pubbliche restano irraggiungibili finché la connessione non funziona.',
      'Start the local test server, then try again. Public receipts stay unreachable until the connection works.',
    ),
    roleUnavailable: localized(
      'Uloga se ne može provjeriti dok veza s testnim poslužiteljem ne proradi.',
      'Il ruolo non può essere verificato finché la connessione al server di test non funziona.',
      'The role cannot be checked until the connection to the test server works.',
    ),
    contextHeading: localized(
      'Opseg ovog testnog tijeka',
      'Ambito di questo flusso di test',
      'Scope of this test workflow',
    ),
  },
  login: {
    heading: localized('Prijava u testno okruženje', "Accesso all'ambiente di test", 'Sign in to the test environment'),
    intro: localized(
      'Uloga dolazi iz poslužiteljske dodjele. Ovdje nije moguće odabrati ili oponašati ulogu.',
      'Il ruolo proviene dall’assegnazione del server. Non è possibile scegliere o impersonare un ruolo qui.',
      'Your role comes from the server assignment. You cannot choose or impersonate a role here.',
    ),
    demoHeading: localized('Demo prijava', 'Accesso demo', 'Demo sign-in'),
    demoNote: localized(
      'Testna instanca sa sintetičkim podacima. Nema stvarnih računa ni stvarnih predmeta.',
      'Istanza di test con dati sintetici. Nessun account reale e nessun caso reale.',
      'Test instance with synthetic data. No real accounts and no real cases.',
    ),
    demoOfficial: localized('Uđi kao službenik', 'Entra come funzionario', 'Enter as the official'),
    demoOfficialHelp: localized(
      'Službenik preuzima predmet, objavljuje obvezu s rokom pod svojim imenom i prijavljuje dovršetak s dokazima.',
      "Il funzionario prende in carico il caso, pubblica l'impegno con una scadenza a proprio nome e segnala il completamento con prove.",
      'The official takes the case, publishes a commitment with a due date under their own name, and reports completion with evidence.',
    ),
    demoOtherHeading: localized('Ostali načini prijave', 'Altri modi per accedere', 'Other ways to sign in'),
    emailHeading: localized('Prijava poveznicom e-pošte', 'Accesso con link e-mail', 'Sign in with an email link'),
    email: localized('Testna adresa e-pošte', 'Indirizzo e-mail di test', 'Test email address'),
    emailHint: localized(
      'Poveznica stiže u konfigurirani testni pretinac, ne na stvarnu poštu.',
      'Il link arriva nella casella di test configurata, non a un indirizzo reale.',
      'The link arrives in the configured test mailbox, not at a real address.',
    ),
    sendLink: localized('Pošalji poveznicu za prijavu', 'Invia il link di accesso', 'Send sign-in link'),
    sending: localized('Slanje poveznice…', 'Invio del link…', 'Sending sign-in link…'),
    sent: localized(
      'Poveznica je poslana kroz konfigurirani testni sustav e-pošte. Otvorite je u ovom pregledniku.',
      'Il link è stato inviato tramite il sistema e-mail di test configurato. Aprilo in questo browser.',
      'The link was sent through the configured test email system. Open it in this browser.',
    ),
    oidc: localized('Prijava za osoblje', 'Accesso del personale', 'Staff sign-in'),
    oidcAction: localized(
      'Nastavi na testnog pružatelja identiteta',
      'Continua al provider di identità di test',
      'Continue to the test identity provider',
    ),
    oidcHelp: localized(
      'Testne uloge osoblja dolaze iz konfiguriranog testnog pružatelja identiteta.',
      'I ruoli di test del personale provengono dal provider di identità di test configurato.',
      'Staff test roles come from the configured test identity provider.',
    ),
    signingIn: localized('Dovršavanje prijave…', 'Completamento dell’accesso…', 'Completing sign-in…'),
    signedIn: localized('Prijava je dovršena.', 'Accesso completato.', 'Sign-in complete.'),
    invalidLink: localized(
      'Poveznica za prijavu nije potpuna ili je istekla. Zatražite novu poveznicu.',
      'Il link di accesso è incompleto o scaduto. Richiedi un nuovo link.',
      'The sign-in link is incomplete or expired. Request a new link.',
    ),
  },
  filing: {
    heading: localized('Podnesite sintetičku prijavu', 'Presenta una segnalazione sintetica', 'File a synthetic report'),
    privacy: localized(
      'Predmet, opis, oznaka lokacije, kontakt i privitci ostaju privatni. Ništa iz tih polja ne ulazi automatski u javnu potvrdu.',
      'Oggetto, descrizione, riferimento del luogo, contatto e allegati restano privati. Nessuno di questi campi entra automaticamente nella ricevuta pubblica.',
      'Subject, narrative, location reference, contact, and attachments remain private. None of these fields enters a public receipt automatically.',
    ),
    subject: localized('Privatni predmet', 'Oggetto privato', 'Private subject'),
    subjectHint: localized('Sažeta sintetička oznaka problema.', 'Breve etichetta sintetica del problema.', 'A short synthetic label for the issue.'),
    narrative: localized('Privatni opis', 'Descrizione privata', 'Private narrative'),
    narrativeHint: localized('Opišite samo izmišljeni testni slučaj.', 'Descrivi solo un caso di prova inventato.', 'Describe a fictional test case only.'),
    location: localized('Sintetička oznaka lokacije', 'Riferimento sintetico del luogo', 'Synthetic location reference'),
    locationHint: localized('Primjer: TEST-LOKACIJA-01. Ne unosite stvarnu adresu.', 'Esempio: TEST-LOKACIJA-01. Non inserire un indirizzo reale.', 'Example: TEST-LOCATION-01. Do not enter a real address.'),
    contact: localized('Kontakt e-pošte za test (neobvezno)', 'E-mail di contatto di test (facoltativa)', 'Test contact email (optional)'),
    attachments: localized('Privatni privitci (neobvezno)', 'Allegati privati (facoltativi)', 'Private attachments (optional)'),
    attachmentHint: localized(
      'Ukupno najviše 2 MiB. Dopuštene su sigurne vrste koje prihvati poslužitelj. Privitci se nikad ne objavljuju.',
      'Massimo 2 MiB in totale. Sono ammessi solo i tipi sicuri accettati dal server. Gli allegati non vengono mai pubblicati.',
      'Maximum 2 MiB total. Only safe types accepted by the server are allowed. Attachments never publish.',
    ),
    submit: localized('Podnesi privatnu prijavu', 'Presenta la segnalazione privata', 'File private report'),
    submitting: localized('Podnošenje prijave…', 'Invio della segnalazione…', 'Filing report…'),
    uploading: localized('Prijenos privatnih privitaka…', 'Caricamento degli allegati privati…', 'Uploading private attachments…'),
    filed: localized('Prijava je podnesena.', 'Segnalazione presentata.', 'Report filed.'),
    required: localized('Ispunite ovo polje.', 'Compila questo campo.', 'Complete this field.'),
    attachmentTooLarge: localized(
      'Privitci zajedno prelaze 2 MiB. Uklonite datoteke i pokušajte ponovno.',
      'Gli allegati superano complessivamente 2 MiB. Rimuovi alcuni file e riprova.',
      'The attachments exceed 2 MiB in total. Remove files and try again.',
    ),
  },
  cases: {
    heading: localized('Moji privatni predmeti', 'I miei casi privati', 'My private cases'),
    intro: localized(
      'Ovaj popis prikazuje samo zapise povezane s vašom prijavljenom testnom ulogom.',
      'Questo elenco mostra solo i record associati al tuo ruolo di test autenticato.',
      'This list shows only records tied to your signed-in test role.',
    ),
    emptyTitle: localized('Još nema vaših predmeta', 'Nessun caso ancora', 'No cases yet'),
    empty: localized('Još niste podnijeli sintetičku prijavu.', 'Non hai ancora presentato una segnalazione sintetica.', 'You have not filed a synthetic report yet.'),
    emptyTipOne: localized(
      'Podnesite sintetičku prijavu; ovdje se pojavljuje čim je zaprimljena.',
      'Presenta una segnalazione sintetica: comparirà qui appena registrata.',
      'File a synthetic report; it appears here as soon as it is recorded.',
    ),
    emptyTipTwo: localized(
      'Tekst prijave javan je od trenutka podnošenja; kontakt i privitci ostaju privatni.',
      'Il testo della segnalazione è pubblico dal momento dell’invio; contatto e allegati restano privati.',
      'The report text is public from the moment it is filed; the contact and attachments stay private.',
    ),
    loadError: localized('Predmeti se nisu mogli učitati.', 'Impossibile caricare i casi.', 'Cases could not be loaded.'),
  },
  detail: {
    heading: localized('Privatni predmet', 'Caso privato', 'Private case'),
    subject: localized('Predmet', 'Oggetto', 'Subject'),
    narrative: localized('Opis', 'Descrizione', 'Narrative'),
    location: localized('Oznaka lokacije', 'Riferimento del luogo', 'Location reference'),
    contact: localized('Kontakt', 'Contatto', 'Contact'),
    events: localized('Privatni slijed događaja', 'Cronologia privata degli eventi', 'Private event trail'),
    attachments: localized('Privatni privitci', 'Allegati privati', 'Private attachments'),
    noAttachments: localized('Nema privitaka.', 'Nessun allegato.', 'No attachments.'),
    hashLinked: localized(
      'Događaji su hash-povezani. Taj trag pokazuje redoslijed zapisa; ne dokazuje istinitost sadržaja.',
      'Gli eventi sono collegati tramite hash. La traccia mostra l’ordine dei record; non dimostra che il contenuto sia vero.',
      'Events are hash-linked. The trail shows record order; it does not prove the content is true.',
    ),
  },
  staff: {
    heading: localized('Radni red odgovornog odsjeka', "Coda dell'ufficio responsabile", 'Responsible office queue'),
    intro: localized(
      'Ured odgovara pod svojim imenom: preuzima odgovornost, objavljuje obvezu s rokom i prijavljuje dovršetak s dokazima. Dovršetak provjerava javnost.',
      'L’ufficio risponde a proprio nome: assume la responsabilità, pubblica l’impegno con una scadenza e segnala il completamento con prove. Il completamento lo verifica il pubblico.',
      'The office answers under its own name: it accepts responsibility, publishes a commitment with a due date, and reports completion with evidence. The public checks completion.',
    ),
    assign: localized('Preuzmi odgovornost', 'Assumi la responsabilità', 'Accept responsibility'),
    assigning: localized('Preuzimanje odgovornosti…', 'Assunzione della responsabilità…', 'Accepting responsibility…'),
    commitmentHeading: localized('Objavi obvezu', 'Pubblica l’impegno', 'Publish the commitment'),
    commitment: localized('Mjerljiva obveza', 'Impegno misurabile', 'Measurable commitment'),
    dueDate: localized('Rok', 'Scadenza', 'Due date'),
    signedByName: localized('Ime i prezime potpisnika', 'Nome e cognome del firmatario', 'Name of the signing person'),
    signedByTitle: localized('Funkcija potpisnika', 'Funzione del firmatario', 'Title of the signing person'),
    signedByHint: localized(
      'Ime i funkcija stoje uz obvezu na javnom zapisu.',
      'Il nome e la funzione compaiono accanto all’impegno nel record pubblico.',
      'The name and title stand next to the commitment on the public record.',
    ),
    publishesNow: localized(
      'Objavljuje se odmah pod vašim imenom.',
      'Viene pubblicato subito a tuo nome.',
      'This publishes at once under your name.',
    ),
    fileCommitment: localized('Objavi obvezu', 'Pubblica l’impegno', 'Publish commitment'),
    filingCommitment: localized('Objava obveze…', 'Pubblicazione dell’impegno…', 'Publishing the commitment…'),
    resolutionHeading: localized('Prijavi dovršetak s dokazima', 'Segnala il completamento con prove', 'Report completion with evidence'),
    evidenceNote: localized('Javna bilješka o dokazima', 'Nota pubblica sulle prove', 'Public evidence note'),
    evidenceUrls: localized('Javne HTTPS poveznice na dokaze', 'Link HTTPS pubblici alle prove', 'Public HTTPS evidence links'),
    evidenceUrlsHint: localized('Jedna HTTPS poveznica po retku.', 'Un link HTTPS per riga.', 'One HTTPS link per line.'),
    evidenceOptional: localized('Dokazi (neobvezno)', 'Prove (facoltative)', 'Evidence (optional)'),
    submitResolution: localized('Prijavi dovršetak', 'Segnala il completamento', 'Report completion'),
    submittingResolution: localized('Prijava dovršetka…', 'Invio del completamento…', 'Reporting completion…'),
    reopenHeading: localized('Prihvati osporavanje', 'Accetta la contestazione', 'Accept the dispute'),
    reopenIntro: localized(
      'Predmet se vraća u „odgovoreno”. Rok i obveza ostaju na javnom zapisu.',
      'Il caso torna a “risposto”. La scadenza e l’impegno restano nel record pubblico.',
      'The case goes back to “answered”. The due date and the commitment stay on the public record.',
    ),
    reopenNote: localized('Bilješka za javni trag (neobvezno)', 'Nota per la cronologia pubblica (facoltativa)', 'Note for the public trail (optional)'),
    reopen: localized('Ponovno otvori predmet', 'Riapri il caso', 'Reopen the case'),
    reopening: localized('Ponovno otvaranje…', 'Riapertura…', 'Reopening…'),
    noAction: localized('Za ovaj status nema dopuštene radnje ureda.', 'Nessuna azione dell’ufficio è consentita per questo stato.', 'No office action is allowed for this status.'),
    attachmentHeading: localized('Dodaj privatni privitak', 'Aggiungi un allegato privato', 'Add a private attachment'),
    attachmentSubmit: localized('Priloži datoteku', 'Allega il file', 'Attach file'),
  },
  publicText: {
    heading: localized('Javni tekst', 'Testo pubblico', 'Public text'),
    intro: localized(
      'Tekst prijave javan je od podnošenja. Ured ga može zadržati, objaviti kakav jest ili objaviti skraćenu verziju. Svaka radnja upisuje se u javni trag.',
      'Il testo della segnalazione è pubblico dall’invio. L’ufficio può trattenerlo, pubblicarlo così com’è o pubblicarne una versione ridotta. Ogni azione entra nella cronologia pubblica.',
      'The report text is public from filing. The office can hold it, release it as filed, or release a shortened version. Every action enters the public trail.',
    ),
    status: localized('Vidljivost teksta', 'Visibilità del testo', 'Text visibility'),
    text: localized('Tekst na javnom zapisu', 'Testo nel record pubblico', 'Text on the public record'),
    heldNotice: localized('Tekst je zadržan. Javni zapis pokazuje samo razlog.', 'Il testo è trattenuto. Il record pubblico mostra solo il motivo.', 'The text is held. The public record shows only the reason.'),
    holdReason: localized('Razlog zadržavanja', 'Motivo del trattenimento', 'Hold reason'),
    labels: localized('Oznake', 'Etichette', 'Labels'),
    noLabels: localized('Nema oznaka.', 'Nessuna etichetta.', 'No labels.'),
    unavailable: localized(
      'Javni zapis se ne može učitati, pa radnje nad tekstom nisu dostupne.',
      'Il record pubblico non può essere caricato, quindi le azioni sul testo non sono disponibili.',
      'The public record cannot be loaded, so the text actions are unavailable.',
    ),
    holdHeading: localized('Zadrži tekst', 'Trattieni il testo', 'Hold the text'),
    holdNote: localized('Interna bilješka (neobvezno)', 'Nota interna (facoltativa)', 'Internal note (optional)'),
    hold: localized('Zadrži tekst', 'Trattieni il testo', 'Hold the text'),
    holding: localized('Zadržavanje teksta…', 'Trattenimento del testo…', 'Holding the text…'),
    held: localized('Tekst je zadržan.', 'Il testo è trattenuto.', 'The text is held.'),
    releaseHeading: localized('Objavi tekst', 'Pubblica il testo', 'Release the text'),
    releaseAsFiled: localized('Objavi kako je podneseno', 'Pubblica come presentato', 'Release as filed'),
    releaseRedacted: localized('Objavi skraćenu verziju', 'Pubblica una versione ridotta', 'Release a shortened version'),
    redactedText: localized('Skraćeni tekst', 'Testo ridotto', 'Shortened text'),
    redactedHint: localized(
      'Uklonite samo ono što mora otići. Skraćivanje je javan događaj.',
      'Togli solo ciò che deve sparire. La riduzione è un evento pubblico.',
      'Remove only what must go. A shortened release is a public event.',
    ),
    releasing: localized('Objava teksta…', 'Pubblicazione del testo…', 'Releasing the text…'),
    released: localized('Tekst je objavljen.', 'Il testo è pubblicato.', 'The text is released.'),
    labelHeading: localized('Oznaka šablonske prijave', 'Etichetta segnalazione modello', 'Form-letter label'),
    labelExplanation: localized(
      'Oznaka ništa ne blokira i ništa ne ističe. Podnositelj je može osporiti porukom uredu.',
      'L’etichetta non blocca e non evidenzia nulla. Chi ha segnalato può contestarla con un messaggio all’ufficio.',
      'The label blocks nothing and highlights nothing. The filer can appeal it with a message to the office.',
    ),
    setLabel: localized('Postavi oznaku', 'Imposta l’etichetta', 'Set the label'),
    clearLabel: localized('Ukloni oznaku', 'Rimuovi l’etichetta', 'Clear the label'),
    labelling: localized('Spremanje oznake…', 'Salvataggio dell’etichetta…', 'Saving the label…'),
    labelled: localized('Oznaka je spremljena.', 'L’etichetta è salvata.', 'The label is saved.'),
    closedNoAction: localized(
      'Predmet je zatvoren. Tekst se više ne mijenja.',
      'Il caso è chiuso. Il testo non cambia più.',
      'The case is closed. The text no longer changes.',
    ),
  },
  channel: {
    label: localized('Kanal prijave', 'Canale della segnalazione', 'Report channel'),
    web: localized('Web obrazac', 'Modulo web', 'Web form'),
    sms: localized('SMS', 'SMS', 'SMS'),
    voice: localized('Telefonski poziv', 'Chiamata telefonica', 'Phone call'),
    unknown: localized('Kanal nije poznat', 'Canale sconosciuto', 'Channel unknown'),
  },
  ai: {
    heading: localized('Prijedlozi AI pripreme', 'Proposte di preparazione AI', 'AI intake proposals'),
    rule: localized(
      'Prijedlog nije odluka. Vrijedi tek kad ga službena osoba prihvati.',
      'Una proposta non è una decisione. Vale solo quando il personale la accetta.',
      'A proposal is not a decision. It counts only once a staff member accepts it.',
    ),
    empty: localized(
      'Za ovaj predmet nema prijedloga AI pripreme.',
      'Nessuna proposta di preparazione AI per questo caso.',
      'No AI intake proposal for this case.',
    ),
    proposed: localized('Prijedlog', 'Proposta', 'Proposal'),
    confidence: localized('Navedena pouzdanost modela', 'Affidabilità dichiarata dal modello', 'Stated model confidence'),
    model: localized('Model', 'Modello', 'Model'),
    lowConfidence: localized(
      'Model je za ovaj prijedlog naveo nisku pouzdanost. Provjerite ga prije prihvaćanja.',
      'Il modello dichiara una bassa affidabilità per questa proposta. Verificala prima di accettarla.',
      'The model states low confidence in this proposal. Check it before accepting.',
    ),
    duplicateRisk: localized(
      'Model tvrdi da je ovo duplikat drugog predmeta. Prihvaćanje povezuje dva predmeta, pa provjerite oba.',
      'Il modello sostiene che questo sia un duplicato di un altro caso. Accettando si collegano i due casi: controllali entrambi.',
      'The model claims this duplicates another case. Accepting links the two cases, so check both.',
    ),
    accept: localized('Prihvati', 'Accetta', 'Accept'),
    reject: localized('Odbaci', 'Rifiuta', 'Reject'),
    deciding: localized('Spremanje odluke…', 'Salvataggio della decisione…', 'Saving decision…'),
    decided: localized('Odluka je zabilježena.', 'La decisione è stata registrata.', 'The decision was recorded.'),
    decidedAt: localized('Odlučeno', 'Deciso', 'Decided'),
    note: localized('Bilješka uz odluku (neobvezno)', 'Nota sulla decisione (facoltativa)', 'Decision note (optional)'),
    loadError: localized(
      'Prijedlozi AI pripreme nisu se mogli učitati.',
      'Impossibile caricare le proposte di preparazione AI.',
      'The AI intake proposals could not be loaded.',
    ),
  },
  messages: {
    heading: localized('Poruke s podnositeljem', 'Messaggi con il segnalante', 'Messages with the filer'),
    noPhone: localized(
      'Broj podnositelja nije dostupan u ovom prikazu.',
      'Il numero del segnalante non è disponibile in questa vista.',
      'The filer’s number is not available in this view.',
    ),
    empty: localized(
      'Još nema poruka na ovom predmetu.',
      'Nessun messaggio su questo caso.',
      'No messages on this case yet.',
    ),
    inbound: localized('Podnositelj', 'Segnalante', 'Filer'),
    outbound: localized('Ured', 'Ufficio', 'Office'),
    labelAppeal: localized('Osporavanje oznake', 'Contestazione dell’etichetta', 'Label appeal'),
    dispute: localized('Osporavanje dovršetka', 'Contestazione del completamento', 'Completion dispute'),
    formHeading: localized('Pošalji pitanje podnositelju', 'Invia una domanda al segnalante', 'Send a question to the filer'),
    body: localized('Tekst pitanja', 'Testo della domanda', 'Question text'),
    bodyHint: localized(
      'Najviše 480 znakova. Poruka odlazi kanalom kojim je prijava zaprimljena.',
      'Massimo 480 caratteri. Il messaggio segue il canale di arrivo della segnalazione.',
      'Up to 480 characters. The message leaves on the channel the report arrived by.',
    ),
    remaining: localized('Preostalo znakova', 'Caratteri rimanenti', 'Characters left'),
    send: localized('Pošalji pitanje', 'Invia la domanda', 'Send question'),
    sending: localized('Slanje poruke…', 'Invio del messaggio…', 'Sending message…'),
    sent: localized('Poruka je predana na dostavu.', 'Il messaggio è stato consegnato al recapito.', 'The message was handed over for delivery.'),
    loadError: localized(
      'Poruke se nisu mogle učitati.',
      'Impossibile caricare i messaggi.',
      'The messages could not be loaded.',
    ),
  },
  close: {
    heading: localized('Zatvori predmet uz razlog', 'Chiudi il caso con una motivazione', 'Close the case with a reason'),
    intro: localized(
      'Zatvaranje zaustavlja rad na predmetu. Javni zapis ostaje vidljiv i nosi javni razlog koji ovdje upišete.',
      'La chiusura ferma il lavoro sul caso. Il record pubblico resta visibile e riporta la motivazione pubblica scritta qui.',
      'Closing stops work on the case. The public record stays visible and carries the public reason written here.',
    ),
    reason: localized('Razlog zatvaranja', 'Motivo della chiusura', 'Closing reason'),
    publicReason: localized('Javni razlog (jedna rečenica)', 'Motivazione pubblica (una frase)', 'Public reason (one sentence)'),
    publicReasonHint: localized(
      'Ovaj tekst čitaju svi. Ne upisujte privatne podatke podnositelja.',
      'Questo testo è leggibile da tutti. Non inserire dati privati del segnalante.',
      'Anyone can read this text. Do not enter the filer’s private details.',
    ),
    note: localized('Interna bilješka (neobvezno)', 'Nota interna (facoltativa)', 'Internal note (optional)'),
    submit: localized('Zatvori predmet', 'Chiudi il caso', 'Close case'),
    confirmHeading: localized('Potvrdite zatvaranje predmeta', 'Conferma la chiusura del caso', 'Confirm closing the case'),
    confirmWarning: localized(
      'Zatvaranje se upisuje u hash-povezani slijed i ne može se poništiti.',
      'La chiusura viene scritta nella cronologia collegata tramite hash e non può essere annullata.',
      'Closing is written into the hash-linked trail and cannot be undone.',
    ),
    confirm: localized('Potvrdi zatvaranje', 'Conferma la chiusura', 'Confirm closing'),
    closing: localized('Zatvaranje predmeta…', 'Chiusura del caso…', 'Closing the case…'),
    closed: localized('Predmet je zatvoren.', 'Il caso è chiuso.', 'The case is closed.'),
    closedHeading: localized('Predmet je zatvoren', 'Caso chiuso', 'Case closed'),
    closedPublicReason: localized('Javni razlog zatvaranja', 'Motivazione pubblica della chiusura', 'Public closing reason'),
    noAction: localized(
      'Predmet se u ovom statusu više ne može zatvoriti.',
      'In questo stato il caso non può più essere chiuso.',
      'The case can no longer be closed in this status.',
    ),
  },
  receipts: {
    heading: localized('Javne potvrde', 'Ricevute pubbliche', 'Public receipts'),
    singular: localized('Javna potvrda', 'Ricevuta pubblica', 'Public receipt'),
    intro: localized(
      'Ovdje su obveze ureda i dokazi o dovršetku, potpisani imenom i funkcijom. Kontakt podnositelja i privitci nisu dio javnog odgovora.',
      'Qui ci sono gli impegni dell’ufficio e le prove di completamento, firmati con nome e funzione. Il contatto del segnalante e gli allegati non fanno parte della risposta pubblica.',
      'Here are the office commitments and the completion evidence, signed with a name and a title. The filer’s contact and the attachments are not part of the public response.',
    ),
    emptyTitle: localized('Još nema javnih potvrda', 'Nessuna ricevuta pubblica', 'No public receipts yet'),
    empty: localized('Nema objavljenih sintetičkih potvrda.', 'Nessuna ricevuta sintetica pubblicata.', 'No synthetic public receipts have been published.'),
    emptyTipOne: localized(
      'Potvrda nastaje kad ured objavi obvezu na predmetu.',
      'Una ricevuta nasce quando l’ufficio pubblica un impegno su un caso.',
      'A receipt appears when the office publishes a commitment on a case.',
    ),
    emptyTipTwo: localized(
      'Do tada predmet ima javni zapis sa stanjem, ali bez odgovora ureda.',
      'Fino ad allora il caso ha un record pubblico con lo stato, ma senza risposta dell’ufficio.',
      'Until then the case has a public record with its state but no office answer.',
    ),
    loadError: localized('Javne potvrde se nisu mogle učitati.', 'Impossibile caricare le ricevute pubbliche.', 'Public receipts could not be loaded.'),
    publicSummary: localized('Obveza ureda', 'Impegno dell’ufficio', 'Office commitment'),
    signedBy: localized('Potpisuje', 'Firmato da', 'Signed by'),
    commitment: localized('Obveza', 'Impegno', 'Commitment'),
    dueDate: localized('Rok obveze', 'Scadenza dell’impegno', 'Commitment due date'),
    evidence: localized('Dokazi o dovršetku', 'Prove di completamento', 'Completion evidence'),
    publicationStatus: localized('Status javne potvrde', 'Stato della ricevuta pubblica', 'Public receipt status'),
    interfaceLanguage: localized('Jezik sučelja', 'Lingua dell’interfaccia', 'Interface language'),
    approvedTextNote: localized(
      'Tekst u nastavku prikazan je točno onako kako ga je ured objavio.',
      'Il testo seguente è mostrato esattamente come l’ufficio lo ha pubblicato.',
      'The wording below is shown exactly as the office published it.',
    ),
    publishedAt: localized('Objavljeno', 'Pubblicato', 'Published'),
    resolvedAt: localized('Dovršetak prijavljen', 'Completamento segnalato', 'Completion reported'),
    publishedNotResolved: localized(
      'Ured je objavio obvezu pod svojim imenom. Ovaj status ne tvrdi da je popravak dovršen.',
      'L’ufficio ha pubblicato l’impegno a proprio nome. Questo stato non dichiara conclusa la riparazione.',
      'The office published the commitment under its own name. This status does not claim the repair is complete.',
    ),
    resolved: localized(
      'Ured je prijavio dovršetak s dokazima. Podnositelj ga može osporiti.',
      'L’ufficio ha segnalato il completamento con prove. Chi ha segnalato può contestarlo.',
      'The office reported completion with evidence. The filer can dispute it.',
    ),
    disputed: localized(
      'Podnositelj je osporio dovršetak. Ured mora ponovno odgovoriti.',
      'Chi ha segnalato ha contestato il completamento. L’ufficio deve rispondere di nuovo.',
      'The filer disputed the completion. The office has to answer again.',
    ),
    events: localized('Javni slijed događaja', 'Cronologia pubblica degli eventi', 'Public event trail'),
    receiptHash: localized('Hash javne potvrde', 'Hash della ricevuta pubblica', 'Public receipt hash'),
    receiptHashNote: localized(
      'Hash povezuje ovu potvrdu sa slijedom zapisa. Ne dokazuje da je tvrdnja istinita niti da je popravak dovršen.',
      'L’hash collega questa ricevuta alla cronologia del record. Non dimostra che l’affermazione sia vera né che la riparazione sia conclusa.',
      'The hash links this receipt to the record trail. It does not prove the claim is true or that the repair is complete.',
    ),
    print: localized('Ispiši potvrdu', 'Stampa la ricevuta', 'Print receipt'),
    sourceLinks: localized('Javne poveznice na dokaze', 'Link pubblici alle prove', 'Public evidence links'),
  },
});

export const statusLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  open: localized('ZAPRIMLJENO', 'RICEVUTO', 'RECEIVED'),
  received: localized('ZAPRIMLJENO', 'RICEVUTO', 'RECEIVED'),
  assigned: localized('Odgovornost preuzeta', 'Responsabilità assunta', 'Responsibility assigned'),
  answered: localized('ODGOVORENO', 'RISPOSTO', 'ANSWERED'),
  resolved: localized('Dovršetak prijavljen', 'Completamento segnalato', 'Completion reported'),
  disputed: localized('OSPORENO', 'CONTESTATO', 'DISPUTED'),
  closed: localized('ZATVORENO', 'CHIUSO', 'CLOSED'),
  unknown: localized('Status nije poznat', 'Stato sconosciuto', 'Status unknown'),
});

/** How much of the filed text the public record carries right now. */
export const textStatusLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  public: localized('JAVNO', 'PUBBLICO', 'PUBLIC'),
  held: localized('ZADRŽANO', 'TRATTENUTO', 'HELD'),
  redacted: localized('SKRAĆENO', 'RIDOTTO', 'SHORTENED'),
  unknown: localized('VIDLJIVOST NIJE POZNATA', 'VISIBILITÀ SCONOSCIUTA', 'VISIBILITY UNKNOWN'),
});

export const holdReasonLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'personal-data': localized('Osobni podaci', 'Dati personali', 'Personal data'),
  abuse: localized('Uvredljiv sadržaj', 'Contenuto offensivo', 'Abusive content'),
  'off-topic': localized('Izvan teme', 'Fuori tema', 'Off topic'),
  other: localized('Drugi razlog', 'Altro motivo', 'Other reason'),
  unknown: localized('Razlog nije poznat', 'Motivo sconosciuto', 'Reason unknown'),
});

export const caseLabelLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'form-letter': localized('Šablonska prijava', 'Segnalazione modello', 'Form letter'),
  unknown: localized('Oznaka', 'Etichetta', 'Label'),
});

/**
 * Origin, AI, delivery, and closing labels. Croatian first; the terms new in
 * this wave (odgovoreno, osporeno, zadržano, šablonska prijava, skraćeni tekst)
 * are not yet in the FLAGGED glossary rows in
 * docs/communication/hr-terminology-glossary.md and still need the native
 * public-sector editor's yes/no (open item O4).
 */
export const originLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  web: pilotCopy.channel.web,
  sms: pilotCopy.channel.sms,
  voice: pilotCopy.channel.voice,
  unknown: pilotCopy.channel.unknown,
});

export const aiStatusLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  proposed: localized('PREDLOŽENO', 'PROPOSTO', 'PROPOSED'),
  accepted: localized('PRIHVAĆENO', 'ACCETTATO', 'ACCEPTED'),
  rejected: localized('ODBAČENO', 'RIFIUTATO', 'REJECTED'),
  superseded: localized('ZAMIJENJENO', 'SOSTITUITO', 'SUPERSEDED'),
  unknown: localized('STANJE NIJE POZNATO', 'STATO SCONOSCIUTO', 'STATUS UNKNOWN'),
});

export const aiKindLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  category: localized('Kategorija', 'Categoria', 'Category'),
  location: localized('Oznaka lokacije', 'Riferimento del luogo', 'Location reference'),
  'duplicate-of': localized('Mogući duplikat', 'Possibile duplicato', 'Possible duplicate'),
  office: localized('Nadležni odsjek', 'Ufficio responsabile', 'Responsible office'),
  unknown: localized('Prijedlog', 'Proposta', 'Proposal'),
});

export const deliveryLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  pending: localized('U DOSTAVI', 'IN CONSEGNA', 'IN DELIVERY'),
  'handed-off': localized('U DOSTAVI', 'IN CONSEGNA', 'IN DELIVERY'),
  delivered: localized('DOSTAVLJENO', 'CONSEGNATO', 'DELIVERED'),
  failed: localized('NEUSPJELA DOSTAVA', 'CONSEGNA NON RIUSCITA', 'DELIVERY FAILED'),
  'not-applicable': localized('NIJE PRIMJENJIVO', 'NON APPLICABILE', 'NOT APPLICABLE'),
  unknown: localized('STANJE DOSTAVE NIJE POZNATO', 'STATO DI CONSEGNA SCONOSCIUTO', 'DELIVERY STATE UNKNOWN'),
});

export const closedReasonLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  duplicate: localized('Duplikat postojećeg predmeta', 'Duplicato di un caso esistente', 'Duplicate of an existing case'),
  'out-of-scope': localized('Izvan nadležnosti odsjeka', 'Fuori dalla competenza dell’ufficio', 'Outside the office’s remit'),
  withdrawn: localized('Podnositelj je povukao prijavu', 'Il segnalante ha ritirato la segnalazione', 'The filer withdrew the report'),
  'insufficient-information': localized('Nedovoljno podataka za postupanje', 'Informazioni insufficienti per agire', 'Not enough information to act'),
  'no-action-possible': localized('Postupanje nije moguće', 'Nessuna azione possibile', 'No action is possible'),
  'resolved-elsewhere': localized('Riješeno u drugom postupku', 'Risolto in un altro procedimento', 'Resolved in another process'),
  unknown: localized('Razlog nije poznat', 'Motivo sconosciuto', 'Reason unknown'),
});

export const roleLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  resident: localized('Stanovnik', 'Residente', 'Resident'),
  official: localized('Odgovorni odsjek', 'Ufficio responsabile', 'Responsible office'),
  gateway: localized('Kanal prijave', 'Canale della segnalazione', 'Report channel'),
  system: localized('Sustav', 'Sistema', 'System'),
});

export const stageLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  voice: localized('Prijava', 'Segnalazione', 'Voice'),
  responsibility: localized('Odgovornost', 'Responsabilità', 'Responsibility'),
  response: localized('Odgovor', 'Risposta', 'Response'),
  check: localized('Provjera javnosti', 'Verifica del pubblico', 'Public check'),
  receipt: localized('Javna potvrda', 'Ricevuta pubblica', 'Public receipt'),
});

export const actionLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'report-filed': localized('Prijava zaprimljena', 'Segnalazione ricevuta', 'Report received'),
  'record-created': localized('Prijava podnesena', 'Segnalazione presentata', 'Report filed'),
  'text-held': localized('Javni tekst zadržan', 'Testo pubblico trattenuto', 'Public text held'),
  'text-released': localized('Javni tekst objavljen', 'Testo pubblico pubblicato', 'Public text released'),
  'label-set': localized('Oznaka postavljena', 'Etichetta impostata', 'Label set'),
  'label-cleared': localized('Oznaka uklonjena', 'Etichetta rimossa', 'Label cleared'),
  'office-assigned': localized('Nadležni odsjek preuzeo odgovornost', 'L’ufficio responsabile ha assunto la responsabilità', 'Responsible office accepted responsibility'),
  'record-assigned': localized('Odgovornost preuzeta', 'Responsabilità assunta', 'Responsibility accepted'),
  'commitment-published': localized('Obveza objavljena pod imenom službene osobe', 'Impegno pubblicato a nome della persona responsabile', 'Commitment published under the official’s name'),
  'completion-reported': localized('Ured prijavio dovršetak s dokazima', 'L’ufficio ha segnalato il completamento con prove', 'The office reported completion with evidence'),
  'completion-disputed': localized('Podnositelj osporio dovršetak', 'Chi ha segnalato ha contestato il completamento', 'The filer disputed the completion'),
  'case-reopened': localized('Predmet ponovno otvoren', 'Caso riaperto', 'Case reopened'),
  'case-resolved-standing': localized('Dovršetak prijavljen i neosporen', 'Completamento segnalato e non contestato', 'Completion reported and not disputed'),
  'attachment-added': localized('Privatni privitak dodan', 'Allegato privato aggiunto', 'Private attachment added'),
  'message-appended': localized('Poruka upisana u predmet', 'Messaggio registrato nel caso', 'Message recorded on the case'),
  'ai-proposal-accepted': localized('Službena osoba prihvatila prijedlog AI pripreme', 'Il personale ha accettato la proposta di preparazione AI', 'Staff accepted the AI intake proposal'),
  'ai-proposal-rejected': localized('Službena osoba odbacila prijedlog AI pripreme', 'Il personale ha rifiutato la proposta di preparazione AI', 'Staff rejected the AI intake proposal'),
  'case-closed': localized('Predmet zatvoren uz navedeni razlog', 'Caso chiuso con la motivazione indicata', 'Case closed with a stated reason'),
});

export const errorMessages: Readonly<Record<string, LocalizedText>> = Object.freeze({
  unauthorized: pilotCopy.common.signInRequired,
  authentication_required: pilotCopy.common.signInRequired,
  invalid_session: pilotCopy.common.signInRequired,
  forbidden: pilotCopy.common.wrongRole,
  wrong_role: pilotCopy.common.wrongRole,
  not_found: localized('Traženi zapis nije pronađen ili mu nemate pristup.', 'Record non trovato o non accessibile.', 'The record was not found or is not available to you.'),
  intake_closed: pilotCopy.entry.intakeClosed,
  stale_version: localized('Zapis je u međuvremenu promijenjen. Ponovno ga učitajte prije nastavka.', 'Il record è cambiato. Ricaricalo prima di continuare.', 'The record changed. Reload it before continuing.'),
  idempotency_conflict: localized('Ovaj je zahtjev već upotrijebljen za drugu radnju. Ponovno učitajte zapis.', 'Questa richiesta è già stata usata per un’altra azione. Ricarica il record.', 'This request was already used for another action. Reload the record.'),
  invalid_state: localized('Radnja nije dopuštena u trenutačnom statusu. Ponovno učitajte zapis.', 'L’azione non è consentita nello stato attuale. Ricarica il record.', 'That action is not allowed in the current status. Reload the record.'),
  dispute_limit: localized(
    'Ovaj je predmet već osporen najviše dopušteni broj puta.',
    'Questo caso è già stato contestato il numero massimo di volte.',
    'This case has already been disputed the maximum number of times.',
  ),
  text_held: localized(
    'Tekst ove prijave je zadržan, pa ta radnja nije moguća.',
    'Il testo di questa segnalazione è trattenuto, quindi questa azione non è possibile.',
    'The text of this report is held, so that action is not possible.',
  ),
  invalid_request: localized('Provjerite unesene podatke i pokušajte ponovno.', 'Controlla i dati inseriti e riprova.', 'Check the entered information and try again.'),
  validation_error: localized('Provjerite označena polja i pokušajte ponovno.', 'Controlla i campi indicati e riprova.', 'Check the marked fields and try again.'),
  attachment_too_large: pilotCopy.filing.attachmentTooLarge,
  unsupported_attachment_type: localized('Vrsta privitka nije dopuštena. Odaberite sigurnu datoteku.', 'Il tipo di allegato non è consentito. Scegli un file sicuro.', 'That attachment type is not allowed. Choose a safe file.'),
  attachment_content_mismatch: localized('Sadržaj privitka ne odgovara prijavljenoj vrsti datoteke. Odaberite ispravnu datoteku.', 'Il contenuto dell’allegato non corrisponde al tipo di file dichiarato. Scegli un file valido.', 'The attachment content does not match its declared file type. Choose a valid file.'),
  backend_not_configured: localized('Testni poslužitelj nije konfiguriran. Obratite se operateru.', 'Il server di test non è configurato. Contatta l’operatore.', 'The test server is not configured. Contact the operator.'),
  upstream_unavailable: pilotCopy.common.connectionError,
  pilot_not_available: localized('Ovaj testni tijek nije dostupan u javnom izdanju.', 'Questo flusso di test non è disponibile nella versione pubblica.', 'This test workflow is unavailable in the public release.'),
  invalid_origin: localized('Zahtjev nije došao s ove aplikacije. Ponovno otvorite stranicu i pokušajte.', 'La richiesta non proviene da questa applicazione. Riapri la pagina e riprova.', 'The request did not come from this application. Reopen the page and try again.'),
  unauthenticated: pilotCopy.common.signInRequired,
  record_not_found: localized('Traženi zapis nije pronađen ili mu nemate pristup.', 'Record non trovato o non accessibile.', 'The record was not found or is not available to you.'),
  public_record_not_found: localized('Javna potvrda nije pronađena.', 'Ricevuta pubblica non trovata.', 'The public receipt was not found.'),
  attachment_not_found: localized('Privitak nije pronađen ili mu nemate pristup.', 'Allegato non trovato o non accessibile.', 'The attachment was not found or is not available to you.'),
  invalid_email: localized('Unesite valjanu testnu adresu e-pošte.', 'Inserisci un indirizzo e-mail di test valido.', 'Enter a valid test email address.'),
  invalid_credentials: localized('Podaci za prijavu nisu prihvaćeni. Zatražite novu poveznicu.', 'Le credenziali non sono state accettate. Richiedi un nuovo link.', 'The sign-in details were not accepted. Request a new link.'),
  invalid_callback_payload: pilotCopy.login.invalidLink,
  login_failed: pilotCopy.login.invalidLink,
  email_not_verified: localized('Testni pružatelj identiteta nije potvrdio adresu e-pošte.', 'Il provider di identità di test non ha verificato l’indirizzo e-mail.', 'The test identity provider did not verify the email address.'),
  rate_limited: localized('Previše pokušaja. Pričekajte pa pokušajte ponovno.', 'Troppi tentativi. Attendi e riprova.', 'Too many attempts. Wait and try again.'),
  identity_provider_unavailable: localized('Testni pružatelj identiteta trenutačno nije dostupan.', 'Il provider di identità di test non è disponibile.', 'The test identity provider is unavailable.'),
  identity_unavailable: localized('Usluga prijave trenutačno nije dostupna.', 'Il servizio di accesso non è disponibile.', 'The sign-in service is unavailable.'),
  oidc_required: localized('Za ovu ulogu upotrijebite organizacijsku prijavu.', 'Per questo ruolo usa l’accesso organizzativo.', 'Use organizational sign-in for this role.'),
  staff_required: pilotCopy.common.wrongRole,
  redirect_uri_not_allowed: pilotCopy.login.invalidLink,
  redirect_uri_required: pilotCopy.login.invalidLink,
  trace_unavailable: pilotCopy.common.connectionError,
  bad_gateway: pilotCopy.common.connectionError,
  upstream_timeout: pilotCopy.common.connectionError,
  upstream_error: pilotCopy.common.connectionError,
  invalid_response: pilotCopy.common.connectionError,
  internal_error: pilotCopy.common.connectionError,
  trace_operation_failed: pilotCopy.common.connectionError,
  method_not_allowed: localized('Ova radnja nije dopuštena.', 'Questa azione non è consentita.', 'This action is not allowed.'),
  idempotency_key_required: localized('Zahtjev nije imao potrebnu sigurnosnu oznaku. Ponovno učitajte stranicu.', 'Alla richiesta manca il riferimento di sicurezza richiesto. Ricarica la pagina.', 'The request lacked its required safety reference. Reload the page.'),
  invalid_idempotency_key: localized('Sigurnosna oznaka zahtjeva nije valjana. Ponovno učitajte stranicu.', 'Il riferimento di sicurezza della richiesta non è valido. Ricarica la pagina.', 'The request safety reference is invalid. Reload the page.'),
  authority_fields_forbidden: localized('Preglednik ne smije zadavati ulogu ili nadležnost.', 'Il browser non può assegnare ruoli o autorità.', 'The browser cannot assign roles or authority.'),
  trusted_headers_forbidden: localized('Zahtjev sadrži nedopuštene podatke o identitetu.', 'La richiesta contiene dati di identità non consentiti.', 'The request contains forbidden identity data.'),
  internal_auth_required: pilotCopy.common.connectionError,
  trusted_actor_required: pilotCopy.common.connectionError,
  body_too_large: localized('Zahtjev je prevelik. Smanjite sadržaj ili privitke i pokušajte ponovno.', 'La richiesta è troppo grande. Riduci il contenuto o gli allegati e riprova.', 'The request is too large. Reduce the content or attachments and try again.'),
  invalid_logout_payload: pilotCopy.common.connectionError,
  trace_integrity_failed: localized('Cjelovitost hash-povezanog slijeda nije prošla provjeru. Privatne pojedinosti nisu prikazane. Obratite se operateru.', 'L’integrità della cronologia collegata tramite hash non ha superato la verifica. I dettagli privati non vengono mostrati. Contatta l’operatore.', 'The hash-linked trail failed its integrity check. Private details are not shown. Contact the operator.'),
  broken_previous_hash: localized('Hash-povezani slijed zapisa nije prošao provjeru. Obratite se operateru.', 'La cronologia collegata tramite hash non ha superato la verifica. Contatta l’operatore.', 'The hash-linked record trail failed verification. Contact the operator.'),
  event_hash_mismatch: localized('Hash-povezani slijed zapisa nije prošao provjeru. Obratite se operateru.', 'La cronologia collegata tramite hash non ha superato la verifica. Contatta l’operatore.', 'The hash-linked record trail failed verification. Contact the operator.'),
  invalid_sequence: localized('Redoslijed događaja nije prošao provjeru. Obratite se operateru.', 'La sequenza degli eventi non ha superato la verifica. Contatta l’operatore.', 'The event sequence failed verification. Contact the operator.'),
  case_not_found: localized('Predmet s tim brojem nije pronađen.', 'Nessun caso con questo numero.', 'No case with that number was found.'),
  message_not_found: localized('Poruka nije pronađena.', 'Messaggio non trovato.', 'The message was not found.'),
  ai_proposal_not_found: localized('Prijedlog AI pripreme nije pronađen.', 'Proposta di preparazione AI non trovata.', 'The AI intake proposal was not found.'),
  ai_proposal_decided: localized('O ovom je prijedlogu već odlučeno. Ponovno učitajte predmet.', 'Questa proposta è già stata decisa. Ricarica il caso.', 'This proposal was already decided. Reload the case.'),
  category_not_allowed: localized('Predložena kategorija nije dopuštena u ovom pilot-projektu.', 'La categoria proposta non è ammessa in questo pilot-progetto.', 'The proposed category is not allowed in this pilot.'),
  duplicate_not_allowed: localized('Predmet naveden kao duplikat ne može se povezati. Provjerite broj predmeta.', 'Il caso indicato come duplicato non può essere collegato. Controlla il numero del caso.', 'The case named as the duplicate cannot be linked. Check the case number.'),
  unknown_field: pilotCopy.common.connectionError,
  invalid_limit: pilotCopy.common.connectionError,
  too_many_attempts: localized('Previše pokušaja. Pričekajte pa pokušajte ponovno.', 'Troppi tentativi. Attendi e riprova.', 'Too many attempts. Wait and try again.'),
  record_state_mismatch: localized('Status zapisa nije prošao provjeru. Obratite se operateru.', 'Lo stato del record non ha superato la verifica. Contatta l’operatore.', 'The record status failed verification. Contact the operator.'),
});

/**
 * Tone for the shared `.status-label` recipe. The word carries the state; the
 * tone only reinforces it, so an unmapped status stays neutral (rule P4).
 */
export const statusTones: Readonly<Record<string, string>> = Object.freeze({
  open: 'trace',
  received: 'trace',
  assigned: 'warning',
  answered: 'valid',
  resolved: 'valid',
  disputed: 'warning',
  closed: 'unknown',
  unknown: 'unknown',
});

/** Held text is a caution, not a failure: the shell and the hash stay public. */
export const textStatusTones: Readonly<Record<string, string>> = Object.freeze({
  public: 'valid',
  held: 'warning',
  redacted: 'warning',
  unknown: 'unknown',
});

export function statusTone(status: unknown): string {
  const key = typeof status === 'string' ? status : 'unknown';
  return statusTones[key] ?? 'unknown';
}

export function translatedStatus(status: unknown, lang: PilotLang): string {
  const key = typeof status === 'string' ? status : 'unknown';
  return (statusLabels[key] ?? statusLabels.unknown)[lang];
}

export function translatedRole(role: unknown, lang: PilotLang): string {
  const key = typeof role === 'string' ? role : '';
  return roleLabels[key]?.[lang] ?? pilotCopy.common.notAvailable[lang];
}

export function translatedAction(action: unknown, lang: PilotLang): string {
  const key = typeof action === 'string' ? action : '';
  return actionLabels[key]?.[lang] ?? localized('Zapis ažuriran', 'Record aggiornato', 'Record updated')[lang];
}

/** The origin badge stays monochrome: the word carries the channel (rule P4). */
export function translatedOrigin(origin: unknown, lang: PilotLang): string {
  const key = typeof origin === 'string' ? origin : 'unknown';
  return (originLabels[key] ?? originLabels.unknown)[lang];
}

export function translatedAiStatus(status: unknown, lang: PilotLang): string {
  const key = typeof status === 'string' ? status : 'unknown';
  return (aiStatusLabels[key] ?? aiStatusLabels.unknown)[lang];
}

export function translatedAiKind(kind: unknown, lang: PilotLang): string {
  const key = typeof kind === 'string' ? kind : 'unknown';
  return (aiKindLabels[key] ?? aiKindLabels.unknown)[lang];
}

export function translatedDelivery(state: unknown, lang: PilotLang): string {
  const key = typeof state === 'string' ? state : 'unknown';
  return (deliveryLabels[key] ?? deliveryLabels.unknown)[lang];
}

export function textStatusTone(status: unknown): string {
  const key = typeof status === 'string' ? status : 'unknown';
  return textStatusTones[key] ?? 'unknown';
}

export function translatedTextStatus(status: unknown, lang: PilotLang): string {
  const key = typeof status === 'string' ? status : 'unknown';
  return (textStatusLabels[key] ?? textStatusLabels.unknown)[lang];
}

export function translatedHoldReason(reason: unknown, lang: PilotLang): string {
  const key = typeof reason === 'string' ? reason : 'unknown';
  return (holdReasonLabels[key] ?? holdReasonLabels.unknown)[lang];
}

export function translatedCaseLabel(label: unknown, lang: PilotLang): string {
  const key = typeof label === 'string' ? label : 'unknown';
  return (caseLabelLabels[key] ?? caseLabelLabels.unknown)[lang];
}

export function translatedClosedReason(reason: unknown, lang: PilotLang): string {
  const key = typeof reason === 'string' ? reason : 'unknown';
  return (closedReasonLabels[key] ?? closedReasonLabels.unknown)[lang];
}

export function translatedError(code: unknown, lang: PilotLang, fallback?: string): string {
  if (typeof code === 'string' && errorMessages[code]) return errorMessages[code][lang];
  return fallback || pilotCopy.common.connectionError[lang];
}
