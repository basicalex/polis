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
 *
 * One photo may ride along. It is decoded, scaled and re-encoded here before it
 * is sent: the canvas keeps the pixels and drops everything around them, so the
 * GPS position and the camera identity an original file carries never leave the
 * phone. The photo goes inside the filing request, not after it, so a case is
 * never filed with half its evidence.
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

/** What the backend takes, decoded: anything larger is refused there. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Long edge of the sent photo. A pothole reads at this size; a face does not. */
const PHOTO_LONG_EDGE = 1600;
const PHOTO_QUALITY = 0.82;
/** The pick failed for a reason the person can act on. */
const PHOTO_TOO_LARGE = 'photo_too_large';

type PhotoSource = ImageBitmap | HTMLImageElement;

function sourceWidth(source: PhotoSource): number {
  return source instanceof HTMLImageElement ? source.naturalWidth : source.width;
}

function sourceHeight(source: PhotoSource): number {
  return source instanceof HTMLImageElement ? source.naturalHeight : source.height;
}

/**
 * `imageOrientation: 'from-image'` applies the EXIF rotation while decoding, so
 * a photo taken sideways is drawn upright. Where the option is not supported the
 * fallback is an `<img>`, which browsers orient from EXIF by themselves.
 */
async function decodePhoto(file: File): Promise<PhotoSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Both bitmap paths failed; the element below is the last one.
      }
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('photo_unreadable'));
    });
    image.src = url;
  });
}

/** Draw on white first: a transparent PNG would otherwise turn black as JPEG. */
async function encodePhoto(source: PhotoSource, longEdge: number): Promise<Blob> {
  const width = sourceWidth(source);
  const height = sourceHeight(source);
  if (!width || !height) throw new Error('photo_unreadable');
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('photo_unreadable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('photo_unreadable'))),
      'image/jpeg',
      PHOTO_QUALITY,
    );
  });
}

function photoBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('photo_unreadable'));
      else resolve(result.slice(comma + 1));
    });
    reader.addEventListener('error', () => reject(new Error('photo_unreadable')));
    reader.readAsDataURL(blob);
  });
}

/**
 * One pass at the full long edge and, if the file is still over the limit, one
 * at half of it. A third pass would be guesswork; the person is told instead.
 */
async function preparePhoto(file: File): Promise<{ blob: Blob; base64: string }> {
  const source = await decodePhoto(file);
  try {
    for (const edge of [PHOTO_LONG_EDGE, PHOTO_LONG_EDGE / 2]) {
      const blob = await encodePhoto(source, edge);
      if (blob.size <= MAX_PHOTO_BYTES) return { blob, base64: await photoBase64(blob) };
    }
    throw new Error(PHOTO_TOO_LARGE);
  } finally {
    if (source instanceof ImageBitmap) source.close();
  }
}

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
  const photoInput = report.querySelector<HTMLInputElement>('[data-photo-input]');
  const photoPicked = report.querySelector<HTMLElement>('[data-photo-picked]');
  const photoThumb = report.querySelector<HTMLImageElement>('[data-photo-thumb]');
  const photoSize = report.querySelector<HTMLElement>('[data-photo-size]');
  const photoRemove = report.querySelector<HTMLButtonElement>('[data-photo-remove]');
  const photoStatus = report.querySelector<HTMLElement>('[data-photo-status]');
  const photoError = report.querySelector<HTMLElement>('[data-photo-error]');
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
  let photo: { contentType: 'image/jpeg'; base64: string } | null = null;
  let photoObjectUrl: string | null = null;
  let preparing = false;
  /** Only the newest pick may write the preview; an older one that finishes late is dropped. */
  let pickCount = 0;

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

  // ---- the photo ----------------------------------------------------------

  function syncSubmit(): void {
    if (!submit) return;
    submit.disabled = sending || preparing;
    submit.textContent = (sending ? strings.sending : strings.submit) ?? '';
  }

  function dropPhoto(): void {
    photo = null;
    if (photoObjectUrl) {
      URL.revokeObjectURL(photoObjectUrl);
      photoObjectUrl = null;
    }
    if (photoThumb) photoThumb.removeAttribute('src');
    if (photoSize) photoSize.textContent = '';
    if (photoPicked) photoPicked.hidden = true;
  }

  async function takePhoto(file: File): Promise<void> {
    const pick = ++pickCount;
    dropPhoto();
    if (photoError) photoError.textContent = '';
    preparing = true;
    if (photoStatus) photoStatus.textContent = strings.photoWorking ?? '';
    syncSubmit();

    try {
      const prepared = await preparePhoto(file);
      if (pick !== pickCount) return;
      photo = { contentType: 'image/jpeg', base64: prepared.base64 };
      photoObjectUrl = URL.createObjectURL(prepared.blob);
      if (photoThumb) photoThumb.src = photoObjectUrl;
      if (photoSize) photoSize.textContent = `${Math.max(1, Math.round(prepared.blob.size / 1024))} kB`;
      if (photoPicked) photoPicked.hidden = false;
    } catch (error) {
      if (pick !== pickCount) return;
      const tooLarge = error instanceof Error && error.message === PHOTO_TOO_LARGE;
      if (photoError) {
        photoError.textContent = (tooLarge ? strings.photoTooLarge : strings.photoUnreadable) ?? '';
      }
    } finally {
      if (pick === pickCount) {
        preparing = false;
        if (photoStatus) photoStatus.textContent = '';
        syncSubmit();
      }
    }
  }

  photoInput?.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    // Clearing the input lets the same file be picked again after a removal.
    photoInput.value = '';
    if (file) void takePhoto(file);
  });

  photoRemove?.addEventListener('click', () => {
    pickCount += 1;
    preparing = false;
    dropPhoto();
    if (photoError) photoError.textContent = '';
    if (photoStatus) photoStatus.textContent = '';
    syncSubmit();
  });

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
    if (sending || preparing) return;
    if (formError) formError.textContent = '';
    const body = textarea.value.trim();
    if (!body) {
      if (textError) textError.textContent = strings.required ?? '';
      textarea.focus();
      return;
    }
    const location_ = [pinLocation(), where?.value.trim() ?? ''].filter(Boolean).join('; ');

    sending = true;
    syncSubmit();

    const filing: { text: string; location?: string; photo?: { contentType: 'image/jpeg'; base64: string } } =
      { text: body };
    if (location_) filing.location = location_;
    // A failed send keeps the photo selected, so a retry is one tap, not another pick.
    if (photo) filing.photo = photo;

    void fileAnonymousCase(filing)
      .then((filed) => {
        // The key rides in the fragment, so it is never part of the request.
        location.assign(
          `${base}${place}/prijava/${encodeURIComponent(filed.caseNumber)}#k=${encodeURIComponent(filed.reopenKey)}`,
        );
      })
      .catch(() => {
        sending = false;
        syncSubmit();
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
