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
    review: localized('Neovisna provjera', 'Revisione indipendente', 'Independent review'),
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
      'Stanovnik podnosi privatnu prijavu. Konfigurirani odsjek preuzima odgovornost i predlaže javnu obvezu. Neovisni provjeritelj odlučuje smije li se obveza objaviti, a zasebno provjerava i tvrdnju da je popravak dovršen.',
      "Il residente presenta una segnalazione privata. L'ufficio configurato assume la responsabilità e propone un impegno pubblico. Un revisore indipendente decide se l'impegno può essere pubblicato e, separatamente, verifica l'eventuale completamento del lavoro.",
      'A resident files a private report. The configured office accepts responsibility and proposes a public commitment. An independent reviewer decides whether that commitment may publish and separately reviews any claim that the repair is complete.',
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
      'Objavljena obveza nije dokaz izvršenog popravka. Status „riješeno” nastaje tek nakon zasebnih dokaza i neovisne provjere.',
      'Un impegno pubblicato non dimostra che la riparazione sia completata. Lo stato “risolto” richiede prove separate e una revisione indipendente.',
      'A published commitment does not prove the repair is complete. “Resolved” requires separate evidence and independent review.',
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
      'Službene i provjeriteljske testne uloge dolaze iz konfiguriranog testnog pružatelja identiteta.',
      'I ruoli di test per il personale e i revisori provengono dal provider di identità di test configurato.',
      'Official and reviewer test roles come from the configured test identity provider.',
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
      'Predmet ostaje privatan sve dok neovisna provjera ne odobri objavu.',
      'Il caso resta privato finché la revisione indipendente non ne autorizza la pubblicazione.',
      'A case stays private until independent review clears it for publication.',
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
      'Odsjek može preuzeti odgovornost, predložiti javni sažetak i obvezu te poslati dokaze o završetku. Ne može objaviti vlastitu obvezu ni označiti popravak riješenim.',
      'L’ufficio può assumere la responsabilità, proporre un riepilogo pubblico e un impegno, e presentare prove di completamento. Non può pubblicare il proprio impegno né dichiarare risolta la riparazione.',
      'The office may accept responsibility, propose a public summary and commitment, and submit completion evidence. It cannot publish its own commitment or mark the repair resolved.',
    ),
    assign: localized('Preuzmi odgovornost', 'Assumi la responsabilità', 'Accept responsibility'),
    assigning: localized('Preuzimanje odgovornosti…', 'Assunzione della responsabilità…', 'Accepting responsibility…'),
    commitmentHeading: localized('Predloži javnu obvezu', 'Proponi un impegno pubblico', 'Propose public commitment'),
    publicSummary: localized('Predloženi javni sažetak', 'Riepilogo pubblico proposto', 'Proposed public summary'),
    commitment: localized('Mjerljiva obveza', 'Impegno misurabile', 'Measurable commitment'),
    dueDate: localized('Rok', 'Scadenza', 'Due date'),
    fileCommitment: localized('Pošalji obvezu na neovisnu provjeru', 'Invia l’impegno alla revisione indipendente', 'Submit commitment for independent review'),
    filingCommitment: localized('Slanje obveze…', 'Invio dell’impegno…', 'Submitting commitment…'),
    resolutionHeading: localized('Pošalji dokaze o završetku', 'Invia prove di completamento', 'Submit completion evidence'),
    evidenceNote: localized('Javna bilješka o dokazima', 'Nota pubblica sulle prove', 'Public evidence note'),
    evidenceUrls: localized('Javne HTTPS poveznice na dokaze', 'Link HTTPS pubblici alle prove', 'Public HTTPS evidence links'),
    evidenceUrlsHint: localized('Jedna HTTPS poveznica po retku.', 'Un link HTTPS per riga.', 'One HTTPS link per line.'),
    submitResolution: localized('Pošalji dokaze na neovisnu provjeru', 'Invia le prove alla revisione indipendente', 'Submit evidence for independent review'),
    submittingResolution: localized('Slanje dokaza…', 'Invio delle prove…', 'Submitting evidence…'),
    noAction: localized('Za ovaj status nema dopuštene radnje ureda.', 'Nessuna azione dell’ufficio è consentita per questo stato.', 'No office action is allowed for this status.'),
    privateFeedback: localized('Privatna povratna informacija provjere', 'Feedback privato della revisione', 'Private review feedback'),
    attachmentHeading: localized('Dodaj privatni privitak', 'Aggiungi un allegato privato', 'Add a private attachment'),
    attachmentSubmit: localized('Priloži datoteku', 'Allega il file', 'Attach file'),
  },
  review: {
    heading: localized('Red za neovisnu provjeru', 'Coda di revisione indipendente', 'Independent review queue'),
    intro: localized(
      'Provjeritelj uspoređuje predloženi javni tekst s privatnim predmetom, odlučuje o objavi i zasebno provjerava dokaze o dovršetku. Prihvaćanje obveze ne znači da je popravak završen.',
      'Il revisore confronta il testo pubblico proposto con il caso privato, decide sulla pubblicazione e valuta separatamente le prove di completamento. Accettare l’impegno non significa che la riparazione sia conclusa.',
      'The reviewer compares proposed public text with the private case, decides publication, and separately reviews completion evidence. Accepting a commitment does not mean the repair is complete.',
    ),
    commitmentHeading: localized('Odluka o objavi obveze', 'Decisione sulla pubblicazione dell’impegno', 'Commitment publication decision'),
    resolutionHeading: localized('Odluka o završetku', 'Decisione sul completamento', 'Completion decision'),
    note: localized('Privatna bilješka odluke', 'Nota privata della decisione', 'Private decision note'),
    noteHint: localized('Bilješka je obvezna pri vraćanju i nikad se ne objavljuje.', 'La nota è obbligatoria per la restituzione e non viene mai pubblicata.', 'A note is required when returning and never publishes.'),
    privacyCheck: localized(
      'Potvrđujem da predloženi javni tekst ne sadrži privatni predmet, opis, kontakt, lokaciju, privitke ni interne identifikatore.',
      'Confermo che il testo pubblico proposto non contiene oggetto privato, descrizione, contatto, luogo, allegati o identificativi interni.',
      'I confirm the proposed public text excludes the private subject, narrative, contact, location, attachments, and internal identifiers.',
    ),
    acceptCommitment: localized('Prihvati i objavi obvezu', 'Accetta e pubblica l’impegno', 'Accept and publish commitment'),
    returnCommitment: localized('Vrati obvezu uredu', 'Restituisci l’impegno all’ufficio', 'Return commitment to office'),
    acceptResolution: localized('Prihvati dovršetak', 'Accetta il completamento', 'Accept completion'),
    returnResolution: localized('Vrati dokaze uredu', 'Restituisci le prove all’ufficio', 'Return evidence to office'),
    deciding: localized('Spremanje odluke…', 'Salvataggio della decisione…', 'Saving decision…'),
    noAction: localized('Ovaj zapis trenutačno ne čeka odluku provjeritelja.', 'Questo record non è in attesa di una decisione del revisore.', 'This record is not awaiting a reviewer decision.'),
    returnNeedsNote: localized('Za vraćanje upišite privatnu bilješku.', 'Per restituire il record, inserisci una nota privata.', 'Add a private note before returning the record.'),
    acceptNeedsCheck: localized('Prije objave potvrdite provjeru privatnosti.', 'Prima della pubblicazione, conferma la verifica della privacy.', 'Confirm the privacy review before publishing.'),
    decisionPermanent: localized(
      'Odluka se trajno upisuje u hash-povezani slijed i ne može se poništiti.',
      'La decisione viene scritta in modo permanente nella cronologia collegata tramite hash e non può essere annullata.',
      'The decision is written permanently into the hash-linked trail and cannot be undone.',
    ),
  },
  receipts: {
    heading: localized('Javne potvrde', 'Ricevute pubbliche', 'Public receipts'),
    singular: localized('Javna potvrda', 'Ricevuta pubblica', 'Public receipt'),
    intro: localized(
      'Ovdje su samo sažeci, obveze i dokazi koje je prihvatila neovisna provjera. Privatni predmet, opis, kontakt, oznaka lokacije i privitci nisu dio javnog odgovora.',
      'Qui compaiono solo riepiloghi, impegni e prove accettati dalla revisione indipendente. Oggetto privato, descrizione, contatto, riferimento del luogo e allegati non fanno parte della risposta pubblica.',
      'Only summaries, commitments, and evidence accepted by independent review appear here. Private subject, narrative, contact, location reference, and attachments are not part of the public response.',
    ),
    emptyTitle: localized('Još nema javnih potvrda', 'Nessuna ricevuta pubblica', 'No public receipts yet'),
    empty: localized('Nema objavljenih sintetičkih potvrda.', 'Nessuna ricevuta sintetica pubblicata.', 'No synthetic public receipts have been published.'),
    emptyTipOne: localized(
      'Potvrda nastaje tek kad neovisna provjera odobri obvezu ureda.',
      'Una ricevuta nasce solo quando la revisione indipendente approva l’impegno dell’ufficio.',
      'A receipt appears only after independent review approves an office commitment.',
    ),
    emptyTipTwo: localized(
      'Do tada su svi zapisi privatni i vidljivi samo sudionicima predmeta.',
      'Fino ad allora ogni record resta privato e visibile solo alle parti del caso.',
      'Until then every record stays private and visible only to the people on the case.',
    ),
    loadError: localized('Javne potvrde se nisu mogle učitati.', 'Impossibile caricare le ricevute pubbliche.', 'Public receipts could not be loaded.'),
    publicSummary: localized('Odobreni javni sažetak', 'Riepilogo pubblico approvato', 'Approved public summary'),
    commitment: localized('Odobrena obveza', 'Impegno approvato', 'Approved commitment'),
    dueDate: localized('Rok obveze', 'Scadenza dell’impegno', 'Commitment due date'),
    evidence: localized('Odobreni dokazi o završetku', 'Prove di completamento approvate', 'Approved completion evidence'),
    publicationStatus: localized('Status javne potvrde', 'Stato della ricevuta pubblica', 'Public receipt status'),
    interfaceLanguage: localized('Jezik sučelja', 'Lingua dell’interfaccia', 'Interface language'),
    approvedTextNote: localized(
      'Tekst u nastavku prikazan je točno onako kako ga je prihvatila neovisna provjera.',
      'Il testo seguente è mostrato esattamente come approvato dalla revisione indipendente.',
      'The wording below is shown exactly as accepted by independent review.',
    ),
    publishedAt: localized('Objavljeno', 'Pubblicato', 'Published'),
    resolvedAt: localized('Dovršetak prihvaćen', 'Completamento accettato', 'Completion accepted'),
    publishedNotResolved: localized(
      'Obveza je objavljena nakon neovisne provjere. Ovaj status ne tvrdi da je popravak dovršen.',
      'L’impegno è stato pubblicato dopo una revisione indipendente. Questo stato non dichiara conclusa la riparazione.',
      'The commitment was published after independent review. This status does not claim the repair is complete.',
    ),
    resolved: localized(
      'Dokazi o dovršetku prihvaćeni su u zasebnoj neovisnoj provjeri.',
      'Le prove di completamento sono state accettate in una revisione indipendente separata.',
      'Completion evidence was accepted in a separate independent review.',
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
  open: localized('Otvoreno', 'Aperto', 'Open'),
  assigned: localized('Odgovornost preuzeta', 'Responsabilità assunta', 'Responsibility assigned'),
  'commitment-pending-review': localized('ČEKA NEOVISNU PROVJERU', 'IN ATTESA DI REVISIONE INDIPENDENTE', 'PENDING REVIEW'),
  returned: localized('Vraćeno iz neovisne provjere', 'Restituito dalla revisione indipendente', 'Returned by independent review'),
  published: localized('Obveza objavljena', 'Impegno pubblicato', 'Commitment published'),
  'resolution-pending-review': localized('Dovršetak čeka neovisnu provjeru', 'Completamento in revisione indipendente', 'Completion pending independent review'),
  resolved: localized('Dovršetak neovisno prihvaćen', 'Completamento accettato indipendentemente', 'Completion independently accepted'),
  unknown: localized('Status nije poznat', 'Stato sconosciuto', 'Status unknown'),
});

export const roleLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  resident: localized('Stanovnik', 'Residente', 'Resident'),
  official: localized('Odgovorni odsjek', 'Ufficio responsabile', 'Responsible office'),
  reviewer: localized('Neovisni provjeritelj', 'Revisore indipendente', 'Independent reviewer'),
});

export const stageLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  voice: localized('Prijava', 'Segnalazione', 'Voice'),
  responsibility: localized('Odgovornost', 'Responsabilità', 'Responsibility'),
  response: localized('Odgovor', 'Risposta', 'Response'),
  check: localized('Neovisna provjera', 'Revisione indipendente', 'Independent check'),
  receipt: localized('Javna potvrda', 'Ricevuta pubblica', 'Public receipt'),
});

export const actionLabels: Readonly<Record<string, LocalizedText>> = Object.freeze({
  'report-filed': localized('Sintetička prijava zaprimljena', 'Segnalazione sintetica ricevuta', 'Synthetic report received'),
  'office-assigned': localized('Nadležni odsjek preuzeo odgovornost', 'L’ufficio responsabile ha assunto la responsabilità', 'Responsible office accepted responsibility'),
  'commitment-filed': localized('Obveza poslana na neovisnu provjeru', 'Impegno inviato alla revisione indipendente', 'Commitment submitted for independent review'),
  'commitment-accepted': localized('Neovisna provjera prihvatila obvezu', 'La revisione indipendente ha accettato l’impegno', 'Independent review accepted the commitment'),
  'completion-approved': localized('Dovršetak prihvaćen nakon zasebne neovisne provjere', 'Completamento accettato dopo una revisione indipendente separata', 'Completion accepted after separate independent review'),
  'record-created': localized('Privatna prijava podnesena', 'Segnalazione privata presentata', 'Private report filed'),
  'record-assigned': localized('Odgovornost preuzeta', 'Responsabilità assunta', 'Responsibility accepted'),
  'commitment-submitted': localized('Obveza poslana na neovisnu provjeru', 'Impegno inviato alla revisione indipendente', 'Commitment submitted for independent review'),
  'commitment-approved': localized('Neovisna provjera prihvatila obvezu', 'La revisione indipendente ha accettato l’impegno', 'Independent review accepted the commitment'),
  'commitment-returned': localized('Neovisna provjera vratila obvezu', 'La revisione indipendente ha restituito l’impegno', 'Independent review returned the commitment'),
  'resolution-submitted': localized('Dokazi o dovršetku poslani na neovisnu provjeru', 'Prove di completamento inviate alla revisione indipendente', 'Completion evidence submitted for independent review'),
  'resolution-approved': localized('Neovisna provjera prihvatila dovršetak', 'La revisione indipendente ha accettato il completamento', 'Independent review accepted completion'),
  'resolution-returned': localized('Neovisna provjera vratila dokaze', 'La revisione indipendente ha restituito le prove', 'Independent review returned the evidence'),
  'attachment-added': localized('Privatni privitak dodan', 'Allegato privato aggiunto', 'Private attachment added'),
  published: localized('Obveza objavljena nakon neovisne provjere', 'Impegno pubblicato dopo la revisione indipendente', 'Commitment published after independent review'),
  resolved: localized('Dovršetak objavljen nakon zasebne neovisne provjere', 'Completamento pubblicato dopo una revisione indipendente separata', 'Completion published after separate independent review'),
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
  self_review_forbidden: localized('Ne možete provjeravati zapis na kojem ste djelovali kao službena osoba.', 'Non puoi revisionare un record sul quale hai agito come responsabile.', 'You cannot review a record you acted on as an official.'),
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
  record_state_mismatch: localized('Status zapisa nije prošao provjeru. Obratite se operateru.', 'Lo stato del record non ha superato la verifica. Contatta l’operatore.', 'The record status failed verification. Contact the operator.'),
});

/**
 * Tone for the shared `.status-label` recipe. The word carries the state; the
 * tone only reinforces it, so an unmapped status stays neutral (rule P4).
 */
export const statusTones: Readonly<Record<string, string>> = Object.freeze({
  open: 'trace',
  assigned: 'warning',
  'commitment-pending-review': 'warning',
  returned: 'warning',
  'resolution-pending-review': 'warning',
  published: 'valid',
  resolved: 'valid',
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

export function translatedError(code: unknown, lang: PilotLang, fallback?: string): string {
  if (typeof code === 'string' && errorMessages[code]) return errorMessages[code][lang];
  return fallback || pilotCopy.common.connectionError[lang];
}
