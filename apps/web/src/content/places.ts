// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * This file keeps the build-time mode and retention copy for server-rendered
 * text. The fetched pilot config wins once available; never block a render on it.
 */
/**
 * Which place slugs Polis answers for.
 *
 * A place is live when a municipality has signed and the pilot backend can take
 * a case for it. Everything else in the boundary set is a known place: it has a
 * name and a spot on the map, and it says "još nije ovdje" (entry-flow R4).
 * Anything that is neither is a 404.
 */

import type { PublicTextMode } from '../lib/pilot/vrsar/model';
import knownPlaces from '../data/geo/hr-places.json' with { type: 'json' };
import type { LocalizedText } from './public-release';

export type { PublicTextMode } from '../lib/pilot/vrsar/model';


export type PlaceStatus = 'live' | 'not-yet';

export interface LivePlace {
  slug: string;
  /** The ADM2 slug in the boundary data; the same string today, kept separate. */
  geoSlug: string;
  county: string;
  pilotId: string;
  caseNumberPrefix: string;
  publicTextMode: PublicTextMode;
  privacy: PlacePrivacy;
  /** Initial report-map camera only. It is never filed until the person selects a point. */
  reportMapCenter: { lat: number; lon: number };
  name: LocalizedText;
  status: 'live';
}
export interface PlacePrivacy {
  controllerName: LocalizedText;
  controllerAddress: LocalizedText;
  dpoContact: string;
  confidentialContact: {
    name: LocalizedText;
    email: string;
    phone: string;
  };
  retentionDays: number;
}


export interface KnownPlace {
  slug: string;
  geoSlug: string;
  county: string;
  name: LocalizedText;
  kind: 'grad' | 'opcina';
  status: 'not-yet';
}

export type Place = LivePlace | KnownPlace;

/** Names come from config/pilots/vrsar-orsera.json; the short form is the label. */
export const livePlaces: LivePlace[] = [
  {
    slug: 'vrsar',
    geoSlug: 'vrsar',
    county: 'istarska',
    pilotId: 'vrsar-orsera',
    caseNumberPrefix: 'VRS',
    // TODO(pilot): confirm with the municipality in writing
    publicTextMode: 'open',
    privacy: {
      // TODO(pilot): confirm with the municipality in writing
      controllerName: { hr: 'Općina Vrsar-Orsera', en: 'Vrsar-Orsera Municipality' },
      // TODO(pilot): confirm with the municipality in writing
      controllerAddress: { hr: 'Trg Degrassi 1, 52450 Vrsar', en: 'Trg Degrassi 1, 52450 Vrsar' },
      // TODO(pilot): confirm with the municipality in writing
      dpoContact: 'szop@vrsar.hr',
      confidentialContact: {
        // TODO(pilot): confirm with the municipality in writing
        name: {
          hr: 'Povjerljiva osoba Općine Vrsar-Orsera',
          en: 'Confidential officer, Vrsar-Orsera Municipality',
        },
        // TODO(pilot): confirm with the municipality in writing
        email: 'povjerljiva.osoba@vrsar.hr',
        // TODO(pilot): confirm with the municipality in writing
        phone: '+385 52 441 026',
      },
      // TODO(pilot): confirm with the municipality in writing
      retentionDays: 730,
    },
    reportMapCenter: { lat: 45.149, lon: 13.605 },
    name: { hr: 'Općina Vrsar', en: 'Vrsar Municipality' },
    status: 'live',
  },
];

const liveBySlug = new Map(livePlaces.map((place) => [place.slug, place]));
const knownBySlug = new Map(knownPlaces.map((place) => [place.slug, place]));

/** The Croatian name carries the legal form; English says it in words. */
function nameOf(name: string, kind: 'grad' | 'opcina'): LocalizedText {
  return kind === 'grad'
    ? { hr: `Grad ${name}`, en: `City of ${name}` }
    : { hr: `Općina ${name}`, en: `${name} Municipality` };
}

export function findPlace(slug: string): Place | undefined {
  const live = liveBySlug.get(slug);
  if (live) return live;
  const known = knownBySlug.get(slug);
  if (!known) return undefined;
  return {
    slug: known.slug,
    geoSlug: known.slug,
    county: known.parent,
    name: nameOf(known.name, known.kind as 'grad' | 'opcina'),
    kind: known.kind as 'grad' | 'opcina',
    status: 'not-yet',
  };
}

export function isLive(slug: string): boolean {
  return liveBySlug.has(slug);
}

/** Every city and municipality of one county, in Croatian alphabetical order. */
export function placesInCounty(county: string): Place[] {
  return knownPlaces
    .filter((place) => place.parent === county)
    .map((place) => findPlace(place.slug))
    .filter((place): place is Place => Boolean(place));
}

export const liveSlugs: readonly string[] = livePlaces.map((place) => place.slug);

/** The one pilot that can take a case today; the flow pages need its backend. */
export const PILOT_PLACE_ID = 'vrsar-orsera';

/**
 * The place behind a slug when it is live and its cases reach the pilot
 * backend. Anything else — a known place without a signed municipality, or a
 * live place on a pilot this build cannot talk to — comes back undefined and
 * the page falls through to the intent screen's "još nije ovdje" (R4).
 */
export function findPilotPlace(slug: string): LivePlace | undefined {
  const place = findPlace(slug);
  return place && place.status === 'live' && place.pilotId === PILOT_PLACE_ID ? place : undefined;
}
