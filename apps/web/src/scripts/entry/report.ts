// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S4 behaviour: draw the place and its neighbours from the county's own
 * boundary file, take a pin on a tap, and file the case.
 *
 * The pin is optional and coarse — there are no street tiles and none are
 * wanted (entry-flow R6). Location is asked for on a tap, never on load (R5).
 * The case number and the reopen key come back in the response body; the key
 * travels on in the fragment of the next address and nowhere else (R10).
 */

import { fileAnonymousCase } from '../../lib/pilot/vrsar/api';
import { lonLatToView, viewToLonLat } from '../../lib/geo/projection';

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

const SVG_NS = 'http://www.w3.org/2000/svg';

const root = document.querySelector<HTMLElement>('[data-report]');
if (root) start(root);

function start(report: HTMLElement): void {
  const form = report.querySelector<HTMLFormElement>('[data-report-form]');
  const mapRoot = report.querySelector<HTMLElement>('[data-report-map]');
  const svg = report.querySelector<SVGSVGElement>('[data-map]');
  const neighbours = report.querySelector<SVGGElement>('[data-layer="neighbours"]');
  const placeLayer = report.querySelector<SVGGElement>('[data-layer="place"]');
  const pinLayer = report.querySelector<SVGGElement>('[data-layer="pin"]');
  const locate = report.querySelector<HTMLButtonElement>('[data-locate]');
  const textarea = report.querySelector<HTMLTextAreaElement>('[data-text]');
  const where = report.querySelector<HTMLInputElement>('[data-where]');
  const submit = report.querySelector<HTMLButtonElement>('[data-submit]');
  const counter = report.querySelector<HTMLElement>('[data-count]');
  const textError = report.querySelector<HTMLElement>('[data-text-error]');
  const formError = report.querySelector<HTMLElement>('[data-form-error]');
  if (!form || !svg || !neighbours || !placeLayer || !pinLayer || !textarea) return;

  const strings = readStrings();
  const base = report.dataset.base === '/en/' ? '/en/' : '/';
  const place = report.dataset.place ?? '';
  const countySlug = report.dataset.county ?? '';
  const geoSlug = report.dataset.geo ?? '';
  const maxText = Number(report.dataset.maxText) || 4000;
  const countFrom = Number(report.dataset.countFrom) || maxText;

  let pin: [number, number] | null = null;
  let pinRadius = 6;
  let sending = false;

  // ---- the map ------------------------------------------------------------

  function paint(file: CountyFile): void {
    const own = file.places.find((item) => item.slug === geoSlug);
    if (!own) return;

    const rest = document.createDocumentFragment();
    for (const item of file.places) {
      if (item.slug === geoSlug) continue;
      const shape = document.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', item.d);
      shape.setAttribute('class', 'place-shape');
      shape.setAttribute('data-status', item.kind === 'otok' ? 'filler' : 'not-yet');
      rest.append(shape);
    }
    neighbours!.replaceChildren(rest);

    const mine = document.createElementNS(SVG_NS, 'path');
    mine.setAttribute('d', own.d);
    mine.setAttribute('class', 'place-shape');
    mine.setAttribute('data-status', 'live');
    placeLayer!.replaceChildren(mine);

    const width = own.bbox[2] - own.bbox[0];
    const height = own.bbox[3] - own.bbox[1];
    const pad = Math.max(width, height) * 0.35;
    const box = [own.bbox[0] - pad, own.bbox[1] - pad, width + pad * 2, height + pad * 2];
    svg!.setAttribute('viewBox', box.map((value) => Math.round(value * 100) / 100).join(' '));
    pinRadius = Math.max(1.5, box[2] / 28);
  }

  async function loadCounty(): Promise<void> {
    if (!countySlug) return;
    try {
      const response = await fetch(`/geo/hr/${countySlug}.json`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;
      paint((await response.json()) as CountyFile);
    } catch {
      // No boundary file, no map. The text and the free-text line still file.
    }
  }

  function drawPin(): void {
    if (!pin) {
      pinLayer!.replaceChildren();
      return;
    }
    const mark = document.createElementNS(SVG_NS, 'circle');
    mark.setAttribute('class', 'report-pin');
    mark.setAttribute('cx', String(Math.round(pin[0] * 100) / 100));
    mark.setAttribute('cy', String(Math.round(pin[1] * 100) / 100));
    mark.setAttribute('r', String(Math.round(pinRadius * 100) / 100));
    pinLayer!.replaceChildren(mark);
  }

  function pointFromEvent(event: PointerEvent | MouseEvent): [number, number] | null {
    const matrix = svg!.getScreenCTM();
    if (!matrix) return null;
    const point = svg!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }

  svg.addEventListener('click', (event) => {
    const point = pointFromEvent(event);
    if (!point) return;
    pin = point;
    drawPin();
  });

  locate?.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        pin = lonLatToView(position.coords.longitude, position.coords.latitude);
        drawPin();
      },
      () => {
        // A refused or failed lookup leaves the map as it is; the pin is optional.
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });

  void loadCounty();

  // ---- the text -----------------------------------------------------------

  function renderCount(): void {
    if (!counter) return;
    const left = maxText - textarea!.value.length;
    const show = textarea!.value.length >= countFrom;
    counter.textContent = show ? `${strings.charsLeft ?? ''} ${left}`.trim() : '';
  }

  textarea.addEventListener('input', () => {
    renderCount();
    if (textError) textError.textContent = '';
  });
  renderCount();

  // ---- filing -------------------------------------------------------------

  /** "<lat>,<lon>" at five decimals: about a metre, which is all a coarse pin means. */
  function pinLocation(): string {
    if (!pin) return '';
    const [lon, lat] = viewToLonLat(pin[0], pin[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return '';
    return `${lat.toFixed(5)},${lon.toFixed(5)}`;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;
    if (formError) formError.textContent = '';
    const body = textarea.value.trim();
    if (!body) {
      if (textError) textError.textContent = strings.required ?? '';
      textarea.focus();
      return;
    }
    const location_ = [pinLocation(), where?.value.trim() ?? ''].filter(Boolean).join('; ');

    sending = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = strings.sending ?? '';
    }

    void fileAnonymousCase(location_ ? { text: body, location: location_ } : { text: body })
      .then((filed) => {
        // The key rides in the fragment, so it is never part of the request.
        location.assign(
          `${base}${place}/prijava/${encodeURIComponent(filed.caseNumber)}#k=${encodeURIComponent(filed.reopenKey)}`,
        );
      })
      .catch(() => {
        sending = false;
        if (submit) {
          submit.disabled = false;
          submit.textContent = strings.submit ?? '';
        }
        if (formError) formError.textContent = strings.failed ?? '';
      });
  });

  if (mapRoot) mapRoot.dataset.ready = 'true';
}

function readStrings(): Record<string, string> {
  const source = document.getElementById('report-strings');
  if (!source?.textContent) return {};
  try {
    return JSON.parse(source.textContent) as Record<string, string>;
  } catch {
    return {};
  }
}
