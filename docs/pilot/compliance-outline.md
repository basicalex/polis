# Publicity mode compliance outline

This outline maps each compliance duty to a pilot control. It is not legal advice or release approval. The municipality must finish every named task before public release.

## Release gates

- The DPO must approve keeping `textSha256` public after erasure.
- The municipality must confirm the controller name and address, DPO contact, confidential contact, and retention period in writing.
- Values in `apps/web/src/content/places.ts` are placeholders.

## L1 GDPR roles and impact assessment

- **Requirement.** The municipality is the controller. Intrface is the processor. They need a GDPR Article 28 processing agreement. Publishing resident text at scale triggers a data protection impact assessment under Article 35.
- **Plan control.** Publicity modes, the compliance pass, erasure, notices, retention, and logged events give the DPIA concrete controls to assess.
- **Municipality task.** Sign the Article 28 agreement, complete the DPIA, name the responsible roles, and approve the residual risk before release.

## L2 GDPR Article 13 information

- **Requirement.** Each place needs a privacy notice at `/<place>/privatnost`. It must name the controller, purpose, Article 6(1)(e) public-task legal basis, what becomes public, retention, resident rights, DPO, and the right to complain to AZOP.
- **Plan control.** Per-place content can explain the selected publicity mode, erasure route, public hash, notice process, and retention period.
- **Municipality task.** Approve and publish the final notice with its real controller address, DPO contact, retention period, and AZOP complaint text.

## L3 GDPR Article 17 erasure

- **Requirement.** A filer may ask to remove public text and location. The office file may remain where archive rules require it. The public text hash remains, subject to the DPO decision in O5.
- **Plan control.** `erase-text` authenticates with the reopen key, removes public text and location, blanks filer dispute text, and logs `text-removed`.
- **Municipality task.** Set the archive basis for the private file, approve the request procedure, and obtain DPO approval for the remaining SHA-256 hash.

## L4 GDPR Article 5(1)(e) storage limitation

- **Requirement.** Public personal text must not stay available longer than its stated purpose requires.
- **Plan control.** Retention removes public text and location after a case has been terminal for `publicTextRetentionDays`, which defaults to 730 days.
- **Municipality task.** Approve the period in writing, state it in the privacy notice, and assign an owner to monitor retention runs and failures.

## L5 GDPR Article 9 special categories

- **Requirement.** Third-party health, ethnicity, religion, sexual orientation, political, or union data needs special care.
- **Plan control.** The special-category detector holds matching text for a human. The model does not publish or remove it.
- **Municipality task.** Define the review, redaction, access, and escalation procedure. Train the staff who handle a held report.

## L6 Croatian GDPR implementation act

- **Requirement.** `Zakon o provedbi Opće uredbe o zaštiti podataka` (Act on the Implementation of the General Data Protection Regulation) makes AZOP the supervisory authority in Croatia. The privacy notice must give the complaint route.
- **Plan control.** The per-place privacy notice has a required AZOP complaint line.
- **Municipality task.** Approve current AZOP details and the Croatian notice text before release.

## L7 Access to information

- **Requirement.** `Zakon o pravu na pristup informacijama` (Right of Access to Information Act, ZPPI) supports proactive publication of the office's commitment and resolution. The case ledger is not a ZPPI request channel.
- **Plan control.** The public record shows the signed commitment, resolution, evidence, and hash-linked events without exposing the private file.
- **Municipality task.** Keep its formal ZPPI request channel, name it on the site, and decide which office records need separate proactive publication.

## L8 Local government and administrative procedure

- **Requirement.** `Zakon o lokalnoj i područnoj (regionalnoj) samoupravi` (Local and Regional Self-Government Act, ZLPRS) and `Zakon o općem upravnom postupku` (General Administrative Procedure Act, ZUP) frame the 30-day answer duty and file confidentiality.
- **Plan control.** `clockDueAt` tracks the answer duty. Contact data, photos, and the private narrative never appear in the public shell.
- **Municipality task.** Confirm when the 30-day clock starts, who owns it, which archive rules apply, and how staff protect the full file.

## L9 DSA notice and reasons

- **Requirement.** Digital Services Act Articles 16 and 17 require a usable notice-and-action path and a statement of reasons where they apply.
- **Plan control.** Public notices can trigger a logged hold with a public reason. The filer receives an appeal message path.
- **Municipality task.** Approve notice categories, response times, reason text, appeal handling, and the person who decides each notice.

## L10 Whistleblower protection

- **Requirement.** `Zakon o zaštiti prijavitelja nepravilnosti` (Whistleblower Protection Act) requires a protected internal reporting route. This platform is not that route.
- **Plan control.** The confidential detector holds likely reports and points the resident to the municipality's confidential officer.
- **Municipality task.** Confirm the confidential officer and protected channel. Approve the public warning and handoff text.

## L11 Defamation and platform role

- **Requirement.** `Kazneni zakon` (Criminal Code), Articles 147–149, covers defamation offences. Intrface does not judge whether a claim is true.
- **Plan control.** Notices, holds, redaction, and closure with a public reason let a human control publication without an automated truth decision.
- **Municipality task.** Set the legal escalation and response process, choose authorized decision-makers, and approve public reason text.

## L12 AI Act

- **Requirement.** The compliance pass is a limited-risk filter with human oversight. Every model hit must be a logged signal. No model removes text.
- **Plan control.** Detectors only hold text for a human. Events record signals and later official action.
- **Municipality task.** Approve human oversight, provider terms, EU hosting, logging, staff instructions, incident handling, and periodic review.

## L13 Web accessibility

- **Requirement.** `Zakon o pristupačnosti mrežnih stranica i programskih rješenja za pokretne uređaje tijela javnog sektora` (Web Accessibility Act) applies to the municipality's public pages. The pilot targets WCAG 2.1 AA.
- **Plan control.** The public shell, privacy notice, notice form, and status text are in the accessibility test scope.
- **Municipality task.** Run an accessibility audit, fix failures, publish the required accessibility statement, and keep an accessible feedback route.

## L14 NIS2 and Croatian cybersecurity law

- **Requirement.** NIS2 and `Zakon o kibernetičkoj sigurnosti` (Cybersecurity Act) may apply. The municipality decides whether the platform is in scope.
- **Plan control.** Intrface documents the hosting region, security logging, and incident contact.
- **Municipality task.** Record the scope decision, set incident and supplier obligations, approve the hosting region, and name operational contacts.
