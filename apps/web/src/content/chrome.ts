// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Site chrome strings, in both product languages.
 *
 * `Base.astro` is the only consumer. Everything the shell says around the page —
 * boundary banner, skip link, navigation labels and notes, the phone menu button,
 * the footer, and the language switch — is written here once, so the local
 * demonstrator and the public release cannot drift apart (DESIGN.md, "Bilingual
 * EN/HR": one typed content source, equal information in both languages).
 *
 * Croatian is the product default: `/` and `/presentation` serve Croatian and
 * English lives under `/en/` (revision 2026-09-09, decision R1). Internal tooling
 * pages whose body copy is English only keep `lang="en"`, so they read the English
 * side of this file and nothing mixes languages inside one page.
 *
 * The release banner text itself stays in `public-release.ts`, beside the fixture
 * and boundary labels it belongs to, and is re-exported here so `Base.astro` has
 * one import for chrome.
 */

import { releaseBanner, releaseBannerDetails, type Lang, type LocalizedText } from './public-release';

export { releaseBanner, releaseBannerDetails };
export type { Lang, LocalizedText };

/** A route that differs between languages: `/presentation` vs `/en/presentation`. */
export type LocalizedHref = Record<Lang, string>;

export type ChromeNavItem = {
  href: string;
  label: LocalizedText;
  note: LocalizedText;
};

export type ChromeNavGroup = {
  id: string;
  label: LocalizedText;
  items: ChromeNavItem[];
};

export type FooterLink = {
  id: string;
  href: LocalizedHref;
  label: LocalizedText;
  /** External destinations open on another host and carry `rel="noreferrer"`. */
  external?: true;
};

export type FooterGroup = {
  id: string;
  label: LocalizedText;
  links: FooterLink[];
};

/* ---------------------------------------------------------------------------
   Language
   --------------------------------------------------------------------------- */

/** Each language names itself, as it does in the demo shell toggle. */
export const languageEndonyms: Record<Lang, string> = {
  en: 'English',
  hr: 'Hrvatski',
};

export const languageSwitch: LocalizedText = {
  en: 'Language',
  hr: 'Jezik',
};

/** Where the other language's copy of a page lives. */
export const languageHomes: LocalizedHref = {
  hr: '/',
  en: '/en/',
};

export const presentationHrefs: LocalizedHref = {
  hr: '/presentation',
  en: '/en/presentation',
};

/* ---------------------------------------------------------------------------
   Shell
   --------------------------------------------------------------------------- */

export const skipLink: LocalizedText = {
  en: 'Skip to content',
  hr: 'Preskoči na sadržaj',
};

export const menuButton: LocalizedText = {
  en: 'Menu',
  hr: 'Izbornik',
};

/** The local demonstrator band. The public release band is `releaseBanner`. */
export const localBanner: LocalizedText = {
  en: 'Demo — synthetic data, development proof keys.',
  hr: 'Demonstracija — izmišljeni podaci, razvojni ključevi dokaza.',
};

/* ---------------------------------------------------------------------------
   Public release navigation
   --------------------------------------------------------------------------- */

export const releaseNav = {
  primary: { en: 'Public release', hr: 'Javno izdanje' },
  boundary: { en: 'Release boundary', hr: 'Granica izdanja' },
  presentation: { en: 'Presentation', hr: 'Prezentacija' },
  transparency: { en: 'Transparency', hr: 'Transparentnost' },
  source: { en: 'Source', hr: 'Izvor' },
  present: { en: 'Present', hr: 'Izlaganje' },
  more: { en: 'More', hr: 'Dalje' },
} satisfies Record<string, LocalizedText>;

/* ---------------------------------------------------------------------------
   Local demonstrator navigation
   --------------------------------------------------------------------------- */

/*
 * Thirteen flat links became four groups so a reader chooses a subject before a
 * destination (rules I2, S3). Each item carries one line saying what the page
 * does; the group holding the current page and the current page itself are
 * marked by weight, not colour (P4). The Account group is rendered around the
 * auth slot in `Base.astro`, so its one static item lives in `accountNav`.
 */
export const localNavGroups: ChromeNavGroup[] = [
  {
    id: 'record',
    label: { en: 'Record', hr: 'Zapis' },
    items: [
      {
        href: '/issues',
        label: { en: 'Issues', hr: 'Teme' },
        note: {
          en: 'Public problems under deliberation',
          hr: 'Javni problemi o kojima se raspravlja',
        },
      },
      {
        href: '/complaints',
        label: { en: 'Complaints', hr: 'Pritužbe' },
        note: {
          en: 'Your own casework, kept private',
          hr: 'Vaši predmeti, koji ostaju privatni',
        },
      },
      {
        href: '/deliberate',
        label: { en: 'Deliberate', hr: 'Rasprava' },
        note: {
          en: 'Conversations that feed an issue',
          hr: 'Razgovori iz kojih nastaje tema',
        },
      },
      {
        href: '/governance/jur-croatia-local',
        label: { en: 'Governance', hr: 'Nadležnosti' },
        note: {
          en: 'Which office answers for what',
          hr: 'Koji ured za što odgovara',
        },
      },
      {
        href: '/assistant',
        label: { en: 'Assistant', hr: 'Pomoćnik' },
        note: {
          en: 'Drafting help with cited sources',
          hr: 'Pomoć pri pisanju, s navedenim izvorima',
        },
      },
    ],
  },
  {
    id: 'trust',
    label: { en: 'Trust', hr: 'Povjerenje' },
    items: [
      {
        href: '/verify',
        label: { en: 'Verify', hr: 'Provjera' },
        note: {
          en: 'Check a file against a registered digest',
          hr: 'Usporedite datoteku sa zabilježenim sažetkom',
        },
      },
      {
        href: '/proofs',
        label: { en: 'Proofs', hr: 'Dokazi' },
        note: {
          en: 'Receipts and the proofs behind them',
          hr: 'Potvrde i dokazi iza njih',
        },
      },
      {
        href: '/audit',
        label: { en: 'Audit', hr: 'Revizijski trag' },
        note: {
          en: 'The append-only event trail',
          hr: 'Zapis događaja koji se samo dopunjuje',
        },
      },
      {
        href: '/transparency',
        label: { en: 'Transparency', hr: 'Transparentnost' },
        note: {
          en: 'What this build does and does not do',
          hr: 'Što ova verzija radi, a što ne radi',
        },
      },
    ],
  },
  {
    id: 'learn',
    label: { en: 'Learn', hr: 'Upute' },
    items: [
      {
        href: '/docs',
        label: { en: 'Docs', hr: 'Dokumentacija' },
        note: {
          en: 'How the platform is put together',
          hr: 'Kako je platforma složena',
        },
      },
      {
        href: '/methodology',
        label: { en: 'Methodology', hr: 'Metodologija' },
        note: {
          en: 'How evidence and review work',
          hr: 'Kako rade dokazi i neovisna provjera',
        },
      },
      {
        href: '/source',
        label: { en: 'Source', hr: 'Izvor' },
        note: {
          en: 'Repository, licence, and build',
          hr: 'Repozitorij, licencija i verzija',
        },
      },
      {
        href: '/privacy',
        label: { en: 'Privacy', hr: 'Privatnost' },
        note: {
          en: 'What is stored and what stays private',
          hr: 'Što se pohranjuje, a što ostaje privatno',
        },
      },
    ],
  },
];

export const accountNav = {
  label: { en: 'Account', hr: 'Račun' },
  login: {
    href: '/login',
    label: { en: 'Login', hr: 'Prijava u sustav' },
    note: {
      en: 'Sign in to file and follow casework',
      hr: 'Prijavite se za podnošenje i praćenje predmeta',
    },
  },
  mandateHolders: {
    href: '/mandate-holders',
    label: { en: 'Mandate-holders', hr: 'Nositelji mandata' },
    note: {
      en: 'People holding a public mandate',
      hr: 'Osobe koje drže javni mandat',
    },
  },
  logout: {
    href: '#',
    label: { en: 'Logout', hr: 'Odjava' },
    note: {
      en: 'End this browser session',
      hr: 'Zatvorite ovu sjednicu preglednika',
    },
  },
} satisfies Record<string, LocalizedText | ChromeNavItem>;

/* ---------------------------------------------------------------------------
   Footer
   --------------------------------------------------------------------------- */

export const footer = {
  navLabel: { en: 'Footer', hr: 'Podnožje' },
  blurb: {
    en: 'Polis is the public response layer between community voice and government action: one record runs from a report to the responsible office, a filed commitment, an independent check, and a public receipt.',
    hr: 'Polis je sloj javnog odgovora između glasa zajednice i djelovanja uprave: jedan zapis vodi od prijave do nadležnog ureda, upisane obveze, neovisne provjere i javne potvrde.',
  },
  groups: [
    {
      id: 'product',
      label: { en: 'Product', hr: 'Proizvod' },
      links: [
        {
          id: 'demonstration',
          href: { en: '/demo', hr: '/demo' },
          label: { en: 'Demonstration', hr: 'Demonstracija' },
        },
        {
          id: 'presentation',
          href: presentationHrefs,
          label: { en: 'Presentation', hr: 'Prezentacija' },
        },
        {
          id: 'record',
          href: { en: '/demo/record', hr: '/demo/record' },
          label: { en: 'Public record', hr: 'Javna evidencija' },
        },
      ],
    },
    {
      id: 'trust',
      label: { en: 'Trust', hr: 'Povjerenje' },
      links: [
        {
          id: 'transparency',
          href: { en: '/transparency', hr: '/transparency' },
          label: { en: 'Transparency', hr: 'Transparentnost' },
        },
        {
          id: 'methodology',
          href: { en: '/methodology', hr: '/methodology' },
          label: { en: 'Methodology', hr: 'Metodologija' },
        },
        {
          id: 'privacy',
          href: { en: '/privacy', hr: '/privacy' },
          label: { en: 'Privacy', hr: 'Privatnost' },
        },
        {
          id: 'security',
          href: { en: '/security', hr: '/security' },
          label: { en: 'Security', hr: 'Sigurnost' },
        },
      ],
    },
    {
      id: 'source',
      label: { en: 'Source', hr: 'Izvor' },
      links: [
        {
          id: 'repository',
          href: {
            en: 'https://github.com/basicalex/polis',
            hr: 'https://github.com/basicalex/polis',
          },
          label: { en: 'Source code on GitHub', hr: 'Izvorni kod na GitHubu' },
          external: true,
        },
        {
          id: 'docs',
          href: { en: '/docs', hr: '/docs' },
          label: { en: 'Documentation', hr: 'Dokumentacija' },
        },
        {
          id: 'licence',
          href: { en: '/source', hr: '/source' },
          label: { en: 'Licence AGPL-3.0-or-later', hr: 'Licencija AGPL-3.0-or-later' },
        },
      ],
    },
  ] satisfies FooterGroup[],
  versionUnavailable: {
    en: 'version unavailable',
    hr: 'verzija nije dostupna',
  },
};

/** Read one localized string. Kept tiny so callers stay readable in markup. */
export function text(value: LocalizedText, lang: Lang): string {
  return value[lang];
}
