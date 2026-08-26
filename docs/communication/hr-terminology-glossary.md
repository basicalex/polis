# Croatian terminology glossary — Polis public surfaces

**This glossary is prepared FOR a native Croatian public-sector editor's review. It is not that
review.** It was assembled by a non-native reader working from the strings currently in the code,
so treat every row as a proposal with a stated reason, not as a settled decision. DESIGN.md (§
"Croatian public-sector terminology review") and `design-lab/pitch/notes.md` both hold external
presentation behind that native review; nothing here lifts that gate. The three terms flagged there
— charter, independent review, public receipt — are marked **FLAGGED** below and need an explicit
yes/no from the editor.

Scope: `apps/web/src/content/demo-strings.mjs`, `apps/web/src/content/public-release.ts`,
`apps/web/src/pages/demo/{citizen,official,review,record,embed}.astro`,
`apps/web/src/pages/release-boundary.astro`.

## Core terms

| EN | HR (current) | Where used | Rationale / alternative considered |
| --- | --- | --- | --- |
| report (noun, what a resident files) | prijava | demo-strings, all demo pages, embed, public-release | Standard JLS word (komunalna prijava). No alternative needed. |
| to file a report | podnijeti prijavu | citizen, embed | Matches "podnositelj prijave". Rejected "poslati prijavu" as less formal. |
| filer / filed by | podnositelj | official, review, record | Current code uses `Podnosi` (a verb) and `Podnio` (a gendered past participle) for the same field label. `Podnositelj` is the administrative noun and is gender-neutral in the label position. |
| intake / received | zaprimanje, zaprimljeno | public-release | Exact HR administrative term for an office receiving a submission. |
| responsibility | odgovornost | everywhere | Direct, no drift found. |
| responsible office | nadležni ured | everywhere | The JLS term. "Odgovorni ured" would read as blame, not jurisdiction. Held consistently. |
| responsible department (framed municipal site) | nadležni odjel | embed | The fictional site names a *komunalni odjel*, so "odjel" is right there; "ured" stays the product-level term. Keep the two apart deliberately. |
| responsible role | nadležna funkcija | official, review (`Nadležna uloga` in record) | Pick one. "Funkcija" is the public-sector word for a post; "uloga" reads as a product role. Recommend "nadležna funkcija" everywhere. |
| commitment | obveza | everywhere | Correct and consistent. Rejected "obećanje" (a promise, not an obligation) and "mjera". |
| response obligation | obveza odgovora | public-release | Consistent. |
| due date | rok | everywhere | Consistent. |
| independent review (FLAGGED) | neovisna provjera | everywhere | Held consistently; no drift to "nezavisna revizija" anywhere in the audited files. Deliberately *not* "revizija", which in Croatian means a formal financial/legal audit under a different legal regime. Editor to confirm "provjera" carries enough weight for a municipal counterparty, and that "neovisna" (not "nezavisna") is the preferred adjective. |
| independent reviewer (FLAGGED) | neovisni provjeritelj | demo-strings, review, record, landing | "Provjeritelj" is attested (provjeritelj činjenica) but is not standard JLS vocabulary. Alternatives considered: "neovisni ocjenjivač", "neovisna provjeriteljska strana", "vanjski provjeritelj". Editor decides. |
| to accept (a commitment) | prihvatiti | review, record | Consistent. |
| to return (a commitment) | vratiti | review, official, record | Consistent. |
| returned by independent review | (two forms in code) | official, review, record | `VRAĆENO NEOVISNOM PROVJEROM` (instrumental agent, a calque) vs `VRAĆENO S NEOVISNE PROVJERE`. Recommend the second, with `PRIHVAĆENO U NEOVISNOJ PROVJERI` as its pair. Editor to confirm. |
| public receipt (FLAGGED) | javna potvrda | demo-strings, public-release, record, review, landing | "Potvrda" alone reads as a certificate issued to a person (potvrda o prebivalištu). The Polis receipt is a hash-linked record that a process was carried out. Alternatives considered: "javna potvrda o postupanju" (clearest, long), "javni upisnik postupanja", "javna evidencija ishoda". Recommendation for the editor: keep "javna potvrda" as the short stage label, and expand once per surface to "javna potvrda o postupanju". |
| public record | javni zapis | everywhere | Consistent. |
| public register | javni registar | embed | Consistent with "evidencija" below? Editor to decide whether "registar" and "evidencija" should collapse to one word. |
| public register (institution line) | javna evidencija | demo-strings `institutionAnchor` | Good JLS vocabulary. See the registar/evidencija question above. |
| trace | trag | record, public-release | Fine for prose. Not an administrative term; acceptable as product vocabulary. |
| appended (event) | upisano / upisani javni događaj | record | `public-release.ts` uses "pridodano" for the same idea. Recommend "upisano" everywhere — Croatian registry vocabulary (upis u evidenciju). |
| response loop | krug odgovora | landing, release-boundary | `record.astro` says "petlja", which is the programming word. Recommend "krug". |
| charter (FLAGGED) | povelja | public-release (stages, `pilotWorksheet`) | "Projektna povelja" is the established HR rendering of "project charter", so "povelja" is defensible. Risk: to a municipal reader "povelja" first suggests a ceremonial declaration. Alternatives considered: "sporazum o pilot-projektu", "projektni zadatak", "okvir pilot-projekta". Editor decides; if "povelja" stays, always qualify it ("povelja pilot-projekta") on first use. |
| pilot target | cilj pilot-projekta | demo-strings, public-release | Correct hyphenation (pilot-projekt). Consistent. |
| case file | spis predmeta | public-release, record | Exact HR term. Good. |
| case narrative | opis slučaja / opis | public-release, record | Consistent enough; editor may prefer "opis predmeta" to match "spis predmeta". |
| subject (of a report) | predmet | record, embed (`Naslov` in citizen) | "Predmet" is the administrative word and is already used on two of three surfaces. Recommend it on citizen too. |
| identity document | identifikacijski dokument | public-release `privateCategories` | HR legal term is "osobna isprava" / "identifikacijska isprava". Recommend "osobna isprava". |
| disclosure (label) | dostupnost | public-release `copy.hr` | "Dostupnost" means availability. Its values are javno / privatno / ograničeno, so "razina javnosti" describes the field better. |
| public read | javno čitanje | public-release `disclosureLabels` | Calque. "Javni uvid" is the HR administrative term for public inspection. |
| restricted / redacted | ograničeno / redigirano | public-release `disclosureLabels` | False friend: HR "redigirati" means to edit copy, not to black out. Under the Croatian FOI act documents are "anonimizirani". Recommend "ograničeno / anonimizirano". |
| audit data | audit podaci | release-boundary | Noun stack plus an untranslated word. "Revizijski podaci" or "podaci nadzora". |
| backend service | pozadinski servis | release-boundary | "Servis" in everyday HR is a repair shop. "Pozadinski sustav" reads better to a non-technical municipal reader. |
| route (URL) | ruta | release-boundary | Technical jargon on a page written for a non-technical reader. "Adresa" is plainer. |
| digest / hash | sažetak, hash | public-release, record | "Sažetak" for digest is right. "hash" stays untranslated and hyphenates as an attribute ("hash-povezan"), which is correct HR practice for an indeclinable foreign attribute. |
| citizen / resident | građanin / stanovnik | demo-strings (`Građanin`), landing (`stanovnik`), public-release (`Stanovnik`) | The EN copy itself mixes citizen and resident, and HR mirrors the mix. Croatian administration addresses "građani". Editor to decide whether HR should collapse to "građanin". |
| official / office-holder | dužnosnik | demo-strings, public-release, landing | "Dužnosnik" means an office-holder (gradonačelnik, pročelnik). `official.astro` describes the surface as "prikaz za gradsku upravu", i.e. staff, who are "službenici". The EN has the same tension. Editor to settle whether the role is a dužnosnik or a službenik. |
| seeded fixture | ugrađeni primjer | demo-strings, citizen, record, embed | Collides with "ugrađeni obrazac" (the embedded widget); `embed.astro` uses both adjectives in one sentence. Recommend "početni primjer" for the seed sense. |
| embedded (widget) | ugrađeni obrazac / ugrađeno sučelje | demo-strings, embed | Fine once "ugrađeni primjer" is renamed. |
| website | stranica | embed, landing | HR standard is "mrežne stranice" (plural) for a site; "stranica" is one page. |
| municipality | općina / grad | landing (`općine`), embed (`grada`) | In Croatia općina and grad are different JLS types. The demo municipality is "Grad Primjer", so embed is right and the landing line should either say "grada" or cover both ("općine ili grada"). |

## Register and style

**Address form.** Body text, hints, errors, and confirmations use the formal Vi throughout, and hold
it well ("Odaberite", "Navedite", "Pročitajte", "Upotrijebite"). Short control labels use the bare
2nd-singular imperative ("Podnesi prijavu", "Preuzmi odgovornost", "Prihvati", "Vrati"). That split
is a common Croatian UI convention and is defensible, but it is not currently written down, and the
landing page breaks it by using Vi on its call-to-action links ("Isprobajte kao stanovnik",
"Pogledajte prezentaciju"). Two coherent options for the editor:

1. Keep the split, and change the landing CTAs to the short imperative.
2. Go Vi everywhere including buttons, which is how a municipality addresses a resident, and change
   the demo buttons.

Until the editor picks, do not mix the two inside one file. `public-release.ts` currently does
(`Koristi izvorne bajtove primjera`, `Promijeni jedan bajt`, `Pokreni prikaz preko cijelog zaslona`
sit beside Vi prose everywhere else in the same file).

**Purpose clauses.** Prefer "kako bi + conditional" over "da + present". The code has four instances
of the "da + present" purpose construction, which the Croatian standard disfavours.

**Clitic order.** Keep the enclitic in second position ("Emulirana je stranica…", "Zapis {id}
objavljen je…"). Where the accusative clitic *je* would collide with the auxiliary *je*, use *ju*
("neovisni provjeritelj ju provjerava").

**Negated verbs take the genitive.** "nema nadležnog ureda", not "nema nadležni ured".

**Numerals.** Croatian needs three count forms, not two: 1 → "upisani javni događaj", 2–4 →
"upisana javna događaja", 5+ → "upisanih javnih događaja". `record.astro` has only the 1 and 5+
forms, so a record with 2–4 appended events renders ungrammatically.

**Noun stacking.** Croatian does not use bare nouns as attributes the way English does. "Polis
naslovnica", "Polis obrazac", "Demo pohrana", "API zahtjev", "hash vrijednosti", "audit podaci" are
all English word order. Use a genitive ("naslovnica Polisa", "obrazac Polisa"), a possessive
adjective, a prepositional phrase ("zahtjev prema API-ju"), or a hyphen for indeclinable foreign
attributes ("demo-pohrana", "hash-povezan").

**Case.** Sentence case for headings and labels. SMALL-CAPS status stamps stay fully uppercase and
are the reviewed meaning-model labels — never paraphrase them; change them only in
`demo-strings.mjs` and `public-release.ts`, where they are defined once.

**Quotation marks.** Croatian pairs are „ … ”. `public-release.ts` uses them correctly. Do not
substitute " … " or “ … ”.

**Dates.** Machine-readable values stay ISO (`2026-11-30`) because that is what the store holds.
Anything a Croatian reader is asked to *read* as a date should render DD.MM.GGGG. with the trailing
dot. The one HR format hint in the code ("Podnosi se kao GGGG-MM-DD.") localizes the placeholder
letters correctly but exposes the ISO order to the reader; the editor should decide whether that is
acceptable for an input hint.

**Diacritics.** No missing or wrong diacritics were found in the audited files. č/ć and dž/đ are
used correctly throughout.

**Fictional material.** "Grad Primjer" is the fictional municipality and never a real one. Vrsar
appears only as a prospective pilot target, always with the boundary sentence attached. Neither
convention changes with language.
