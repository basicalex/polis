// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S1 behaviour: choose a region, the map zooms and the municipalities become
 * hittable (entry-flow R3). Everything here is an upgrade on markup that
 * already works: without scripting the county links and the region form are
 * plain GET navigations to `/?zupanija=<slug>`.
 *
 * No map provider, no tiles, no external request — the shapes are our own SVG
 * and the county files are same-origin JSON (R6).
 */

import { lonLatToView } from '../../lib/geo/projection';
import { parsePathRings, pointInRings, type Ring } from '../../lib/geo/shapes';

interface CountyPlace {
  slug: string;
  name: string;
  kind: 'grad' | 'opcina' | 'otok';
  d: string;
  bbox: [number, number, number, number];
  centroid: [number, number];
}

interface CountyFile {
  county: string;
  name: string;
  bbox: [number, number, number, number];
  places: CountyPlace[];
}

interface PlaceRow {
  slug: string;
  name: string;
  kind: 'grad' | 'opcina';
  parent: string;
  centroid: [number, number];
}

type Strings = Record<string, string>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const COUNTRY_VIEW: [number, number, number, number] = [0, 0, 1000, 980];

const root = document.querySelector<HTMLElement>('[data-entry-map]');
if (root) start(root);

function start(map: HTMLElement): void {
  const svg = map.querySelector<SVGSVGElement>('[data-map]');
  const countiesLayer = map.querySelector<SVGGElement>('[data-layer="counties"]');
  const placesLayer = map.querySelector<SVGGElement>('[data-layer="places"]');
  const note = document.querySelector<HTMLElement>('[data-note]');
  const region = document.querySelector<HTMLSelectElement>('[data-region]');
  const regionForm = document.querySelector<HTMLFormElement>('[data-region-form]');
  const locate = document.querySelector<HTMLButtonElement>('[data-locate]');
  const reset = document.querySelector<HTMLButtonElement>('[data-reset]');
  const search = document.querySelector<HTMLInputElement>('[data-search]');
  const results = document.querySelector<HTMLElement>('[data-results]');
  const countyList = document.querySelector<HTMLElement>('[data-county-list]');
  const hover = map.querySelector<HTMLElement>('[data-hover]');
  if (!svg || !countiesLayer || !placesLayer || !note) return;

  const strings: Strings = readStrings();
  const base = map.dataset.base === '/en/' ? '/en/' : '/';
  const liveSlugs = new Set((map.dataset.live ?? '').split(',').filter(Boolean));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const countyFiles = new Map<string, CountyFile>();
  const countyRings = new Map<string, Ring[]>();
  let placeIndex: PlaceRow[] | null = null;
  let placeIndexPromise: Promise<PlaceRow[]> | null = null;
  let current = map.dataset.county ?? '';
  let animation = 0;

  const countyNames = new Map<string, string>();
  for (const link of countiesLayer.querySelectorAll<SVGAElement>('[data-county]')) {
    const slug = link.dataset.county ?? '';
    countyNames.set(slug, link.getAttribute('aria-label') ?? slug);
  }

  // The map is live from here on, so the region form no longer has to reload.
  if (countyList) countyList.hidden = true;
  if (reset) reset.hidden = !current;

  // ---- painting ----------------------------------------------------------

  function say(message: string): void {
    note!.textContent = message;
  }

  function viewBoxOf(bbox: [number, number, number, number]): [number, number, number, number] {
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    const pad = Math.max(width, height) * 0.08;
    return [bbox[0] - pad, bbox[1] - pad, width + pad * 2, height + pad * 2];
  }

  function setViewBox(target: [number, number, number, number], animate: boolean): void {
    cancelAnimationFrame(animation);
    const apply = (box: number[]) => svg!.setAttribute('viewBox', box.map((v) => Math.round(v * 100) / 100).join(' '));
    const from = (svg!.getAttribute('viewBox') ?? COUNTRY_VIEW.join(' ')).split(/\s+/).map(Number);
    if (!animate || reducedMotion.matches || from.length !== 4) {
      apply(target);
      scaleLabels(target[2]);
      return;
    }
    const started = performance.now();
    const duration = 420;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      apply(from.map((value, index) => value + (target[index] - value) * eased));
      scaleLabels(from[2] + (target[2] - from[2]) * eased);
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  function scaleLabels(viewWidth: number): void {
    const size = Math.max(2, viewWidth / 26);
    for (const label of placesLayer!.querySelectorAll<SVGTextElement>('.place-label')) {
      label.setAttribute('font-size', String(Math.round(size * 100) / 100));
      label.setAttribute('stroke-width', String(Math.round((size / 6) * 100) / 100));
    }
  }

  function drawCounty(file: CountyFile): void {
    const fragment = document.createDocumentFragment();
    for (const place of file.places) {
      const filler = place.kind === 'otok';
      const live = liveSlugs.has(place.slug);
      const shape = document.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', place.d);
      shape.setAttribute('class', 'place-shape');
      shape.setAttribute('data-status', filler ? 'filler' : live ? 'live' : 'not-yet');
      if (filler) {
        shape.setAttribute('aria-hidden', 'true');
        fragment.append(shape);
        continue;
      }
      const link = document.createElementNS(SVG_NS, 'a');
      link.setAttribute('href', `${base}${place.slug}`);
      link.setAttribute('aria-label', live ? place.name : `${place.name} — ${strings.notHereYet}`);
      link.dataset.place = place.slug;
      link.dataset.status = live ? 'live' : 'not-yet';
      link.dataset.name = place.name;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = place.name;
      link.append(shape, title);
      fragment.append(link);
      if (live) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'place-label');
        label.setAttribute('x', String(place.centroid[0]));
        label.setAttribute('y', String(place.centroid[1] - (place.bbox[3] - place.bbox[1]) / 2 - 2));
        label.textContent = place.name;
        fragment.append(label);
      }
    }
    placesLayer!.replaceChildren(fragment);
  }

  async function loadCounty(slug: string): Promise<CountyFile | null> {
    const cached = countyFiles.get(slug);
    if (cached) return cached;
    try {
      const response = await fetch(`/geo/hr/${slug}.json`, { headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      const file = (await response.json()) as CountyFile;
      countyFiles.set(slug, file);
      return file;
    } catch {
      return null;
    }
  }

  async function openCounty(slug: string, animate: boolean): Promise<CountyFile | null> {
    const link = countiesLayer!.querySelector<SVGAElement>(`[data-county="${CSS.escape(slug)}"]`);
    if (!link) return null;
    current = slug;
    map.dataset.county = slug;
    map.dataset.zoom = 'county';
    if (region && region.value !== slug) region.value = slug;
    if (reset) reset.hidden = false;
    for (const shape of countiesLayer!.querySelectorAll<SVGPathElement>('.county-shape')) {
      shape.removeAttribute('data-selected');
    }
    link.querySelector('.county-shape')?.setAttribute('data-selected', 'true');

    const file = await loadCounty(slug);
    if (!file) {
      say(strings.pickOnMap);
      return null;
    }
    drawCounty(file);
    setViewBox(viewBoxOf(file.bbox), animate);
    history.replaceState(null, '', `${base}?zupanija=${slug}`);
    return file;
  }

  function showCountry(): void {
    current = '';
    delete map.dataset.county;
    map.dataset.zoom = 'country';
    placesLayer!.replaceChildren();
    if (region) region.value = '';
    if (reset) reset.hidden = true;
    for (const shape of countiesLayer!.querySelectorAll<SVGPathElement>('.county-shape')) {
      shape.removeAttribute('data-selected');
    }
    setViewBox(COUNTRY_VIEW, true);
    history.replaceState(null, '', base);
    say('');
  }

  // ---- the three ways in --------------------------------------------------

  // The shape under the pointer or the focus ring names itself, so a county is
  // readable without a tooltip a keyboard cannot open.
  for (const event of ['pointerover', 'focusin'] as const) {
    map.addEventListener(event, (moment) => {
      const target = (moment.target as Element).closest<SVGAElement>('[data-county], [data-place]');
      if (hover) hover.textContent = target?.getAttribute('aria-label') ?? '';
    });
  }
  for (const event of ['pointerleave', 'focusout'] as const) {
    map.addEventListener(event, () => {
      if (hover) hover.textContent = '';
    });
  }

  countiesLayer.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<SVGAElement>('[data-county]');
    if (!link || event.defaultPrevented || isModified(event)) return;
    event.preventDefault();
    say('');
    void openCounty(link.dataset.county ?? '', true);
  });

  placesLayer.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<SVGAElement>('[data-place]');
    if (!link || isModified(event)) return;
    if (link.dataset.status === 'live') return; // let the link open the place
    event.preventDefault();
    say(`${link.dataset.name} — ${strings.notHereYet}`);
  });

  region?.addEventListener('change', () => {
    say('');
    if (region.value) void openCounty(region.value, true);
    else showCountry();
  });

  regionForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    say('');
    if (region?.value) void openCounty(region.value, true);
    else showCountry();
  });

  reset?.addEventListener('click', () => showCountry());

  locate?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      say(strings.pickOnMap);
      return;
    }
    say(strings.locating);
    navigator.geolocation.getCurrentPosition(
      (position) => void resolvePosition(position.coords.longitude, position.coords.latitude),
      () => say(strings.pickOnMap),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });

  async function resolvePosition(lon: number, lat: number): Promise<void> {
    const point = lonLatToView(lon, lat);
    const county = countyAt(point);
    if (!county) {
      say(strings.pickOnMap);
      return;
    }
    const file = await openCounty(county, true);
    if (!file) return;
    const hit = file.places.find(
      (place) => place.kind !== 'otok' && pointInRings(point, parsePathRings(place.d)),
    );
    if (!hit) {
      say(strings.pickOnMap);
      return;
    }
    if (liveSlugs.has(hit.slug)) {
      location.assign(`${base}${hit.slug}`);
      return;
    }
    say(`${hit.name} — ${strings.notHereYet}`);
  }

  function countyAt(point: [number, number]): string | null {
    for (const link of countiesLayer!.querySelectorAll<SVGAElement>('[data-county]')) {
      const slug = link.dataset.county ?? '';
      let rings = countyRings.get(slug);
      if (!rings) {
        rings = parsePathRings(link.querySelector('path')?.getAttribute('d') ?? '');
        countyRings.set(slug, rings);
      }
      if (pointInRings(point, rings)) return slug;
    }
    return null;
  }

  // ---- typed search -------------------------------------------------------

  function fold(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }

  async function places(): Promise<PlaceRow[]> {
    if (placeIndex) return placeIndex;
    if (!placeIndexPromise) {
      placeIndexPromise = fetch('/geo/hr-places.json', { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? (response.json() as Promise<PlaceRow[]>) : []))
        .catch(() => []);
    }
    placeIndex = await placeIndexPromise;
    return placeIndex;
  }

  async function runSearch(query: string): Promise<void> {
    if (!results) return;
    const needle = fold(query.trim());
    if (needle.length < 2) {
      results.replaceChildren();
      results.hidden = true;
      return;
    }
    const rows = (await places())
      .filter((row) => fold(row.name).startsWith(needle))
      .slice(0, 8);
    results.hidden = false;
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'entry-result-empty muted';
      empty.textContent = strings.searchNoResults;
      results.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'entry-result';
      link.href = `${base}${row.slug}`;
      const name = document.createElement('span');
      name.textContent = row.name;
      const county = document.createElement('span');
      county.className = 'entry-result-county';
      county.textContent = countyNames.get(row.parent) ?? row.parent;
      link.append(name, county);
      if (!liveSlugs.has(row.slug)) {
        link.addEventListener('click', (event) => {
          if (isModified(event)) return;
          event.preventDefault();
          void openCounty(row.parent, true).then(() => say(`${row.name} — ${strings.notHereYet}`));
        });
      }
      item.append(link);
      fragment.append(item);
    }
    results.replaceChildren(fragment);
  }

  let searchTimer = 0;
  search?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const value = search.value;
    searchTimer = window.setTimeout(() => void runSearch(value), 120);
  });
  search?.closest('form')?.addEventListener('submit', (event) => event.preventDefault());

  // ---- first paint --------------------------------------------------------

  if (current) void openCounty(current, false);
}

function isModified(event: Event): boolean {
  const mouse = event as MouseEvent;
  return mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || mouse.button > 0;
}

function readStrings(): Strings {
  const source = document.getElementById('entry-strings');
  if (!source?.textContent) return {};
  try {
    return JSON.parse(source.textContent) as Strings;
  } catch {
    return {};
  }
}
