// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The optional street-level picker, in two states.
 *
 * Compact is a square thumbnail with every Leaflet handler switched off, so the
 * map can never swallow a page scroll. A button over the tiles opens it; the
 * "Moja lokacija" pill on the thumbnail drops a point without opening anything,
 * and the "Izbriši" pill beside it takes the point away, also without opening.
 *
 * Expanded fills the form column, turns the handlers back on and shows the
 * buttons underneath. With a point the choice is remove or confirm: remove
 * drops the point and collapses, confirm keeps it and collapses. With no point
 * one button closes, which puts the last confirmed point back — so does Escape.
 * The coordinates the form submits change on confirm, on "Moja lokacija" from
 * the compact row and on either "Izbriši" — never while the person is still
 * moving the marker around.
 */

import * as L from 'leaflet';

/** One replaceable endpoint; browser requests keep normal cache and referrer behaviour. */
export const REPORT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const INITIAL_ZOOM = 15;
const LOCATION_ZOOM = 17;
const MAX_ZOOM = 19;
/** Matches the width transition in entry.css; the fallback fires if it never runs. */
const EXPAND_MS = 200;
const EXPAND_FALLBACK_MS = 400;
/** Below this the fix is exact enough that saying a number would only worry people. */
const ACCURACY_FLOOR_M = 100;

export interface ReportCoordinates {
  lat: number;
  lon: number;
}

/** A position reduced to what the form needs, plus the radius the device claims. */
export interface ReportFix extends ReportCoordinates {
  accuracy: number | null;
}

export type LocateOutcome =
  { kind: 'fix'; fix: ReportFix } | { kind: 'denied' } | { kind: 'failed' };

/** The shape of `navigator.geolocation.getCurrentPosition`, so tests can pass a fake. */
export type PositionGetter = (
  onSuccess: (position: GeolocationPosition) => void,
  onError: (error: GeolocationPositionError) => void,
  options: PositionOptions,
) => void;

/** One quick fix from whatever the device already knows. */
export const LOCATION_FAST: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 8_000,
};

/** The slow, exact one: a real GPS or Wi-Fi fix. */
export const LOCATION_PRECISE: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
};

const PERMISSION_DENIED = 1;

function finiteCoordinates(coordinates: ReportCoordinates): boolean {
  return Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon);
}

function coordinateText(coordinates: ReportCoordinates): string {
  return `${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`;
}

function toFix(position: GeolocationPosition): ReportFix | null {
  const fix: ReportFix = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  };
  return finiteCoordinates(fix) ? fix : null;
}

/**
 * Rounds the claimed radius to something a person can read. Returns null while
 * the fix is good enough that the number would say nothing useful.
 */
export function accuracyMetres(accuracy: number | null): number | null {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy <= ACCURACY_FLOOR_M) return null;
  const step = accuracy >= 1000 ? 100 : 10;
  return Math.round(accuracy / step) * step;
}

function attempt(get: PositionGetter, options: PositionOptions): Promise<ReportFix | number> {
  return new Promise((resolve) => {
    let settled = false;
    const once = (value: ReportFix | number): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      get(
        (position) => {
          const fix = toFix(position);
          once(fix ?? 0);
        },
        (error) => once(typeof error?.code === 'number' ? error.code : 0),
        options,
      );
    } catch {
      once(0);
    }
  });
}

function isFix(value: ReportFix | number): value is ReportFix {
  return typeof value !== 'number';
}

/**
 * Two attempts, not one. The old single high-accuracy call timed out on laptops
 * and indoors and the person was told their location could not be found while
 * the device knew it perfectly well. So: ask for a cheap cached fix first and
 * use it at once, then ask for an exact one and move the marker only if it is
 * genuinely better. A cheap failure is retried once at high accuracy; a refused
 * permission is never retried, because the answer will not change.
 *
 * `onFix` runs for the first usable fix and again for a better one. The promise
 * settles on the best outcome of the whole sequence.
 */
export async function locateBestEffort(
  get: PositionGetter,
  onFix: (fix: ReportFix) => void = () => {},
): Promise<LocateOutcome> {
  const first = await attempt(get, LOCATION_FAST);

  if (!isFix(first)) {
    if (first === PERMISSION_DENIED) return { kind: 'denied' };
    const retry = await attempt(get, LOCATION_PRECISE);
    if (!isFix(retry)) return retry === PERMISSION_DENIED ? { kind: 'denied' } : { kind: 'failed' };
    onFix(retry);
    return { kind: 'fix', fix: retry };
  }

  onFix(first);
  const refined = await attempt(get, LOCATION_PRECISE);
  if (!isFix(refined)) return { kind: 'fix', fix: first };
  const better =
    refined.accuracy !== null && (first.accuracy === null || refined.accuracy < first.accuracy);
  if (!better) return { kind: 'fix', fix: first };
  onFix(refined);
  return { kind: 'fix', fix: refined };
}

interface ReportMapStrings {
  mapUnavailable: string;
  mapLocationDenied: string;
  mapLocationError: string;
  mapSelected: string;
  mapCleared: string;
  mapMarkerLabel: string;
  mapZoomIn: string;
  mapZoomOut: string;
  mapAccuracy: string;
  mapInsecure: string;
  locating: string;
}

interface ReportMapOptions {
  center: ReportCoordinates;
  strings: ReportMapStrings;
  onCoordinatesChange: (coordinates: ReportCoordinates | null) => void;
}

/**
 * Adds the optional street-level picker without owning the filing form. If this
 * throws, report.ts leaves text, photo and submission behaviour running.
 */
export function initReportMap(root: HTMLElement, options: ReportMapOptions): void {
  const canvas = root.querySelector<HTMLElement>('[data-report-map-canvas]');
  const growing = root.querySelector<HTMLElement>('[data-map-frame]');
  const open = root.querySelector<HTMLButtonElement>('[data-map-open]');
  const bar = root.querySelector<HTMLElement>('[data-map-bar]');
  const confirm = root.querySelector<HTMLButtonElement>('[data-map-confirm]');
  const close = root.querySelector<HTMLButtonElement>('[data-map-close]');
  const remove = root.querySelector<HTMLButtonElement>('[data-map-remove]');
  const locate = root.querySelector<HTMLButtonElement>('[data-locate]');
  const pill = root.querySelector<HTMLButtonElement>('[data-remove-location]');
  const status = root.querySelector<HTMLElement>('[data-map-status]');
  const error = root.querySelector<HTMLElement>('[data-map-error]');
  if (
    !canvas ||
    !growing ||
    !open ||
    !bar ||
    !confirm ||
    !close ||
    !remove ||
    !locate ||
    !pill ||
    !status ||
    !error ||
    !finiteCoordinates(options.center)
  ) {
    throw new Error('report_map_markup');
  }
  const mapCanvas = canvas;
  const frame = growing;
  const openButton = open;
  const barElement = bar;
  const confirmButton = confirm;
  const closeButton = close;
  const removeButton = remove;
  const removePill = pill;
  const locateButton = locate;
  const mapStatus = status;
  const mapError = error;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const map = L.map(canvas, {
    attributionControl: false,
    center: [options.center.lat, options.center.lon],
    fadeAnimation: !reducedMotion,
    keyboard: true,
    markerZoomAnimation: !reducedMotion,
    maxZoom: MAX_ZOOM,
    minZoom: 3,
    scrollWheelZoom: true,
    zoom: INITIAL_ZOOM,
    zoomAnimation: !reducedMotion,
    zoomControl: false,
  });

  L.control
    .zoom({
      position: 'topright',
      zoomInTitle: options.strings.mapZoomIn,
      zoomOutTitle: options.strings.mapZoomOut,
    })
    .addTo(map);

  const tiles = L.tileLayer(REPORT_MAP_TILE_URL, {
    maxNativeZoom: MAX_ZOOM,
    maxZoom: MAX_ZOOM,
    minZoom: 3,
  });
  const failedTiles = new Set<HTMLElement>();

  function syncTileFailure(): void {
    if (failedTiles.size > 0) {
      root.dataset.tiles = 'error';
      mapError.textContent = options.strings.mapUnavailable;
      return;
    }
    delete root.dataset.tiles;
    mapError.textContent = '';
  }

  tiles.on('tileerror', (event: L.TileErrorEvent) => {
    failedTiles.add(event.tile);
    syncTileFailure();
  });
  const resolveTileFailure = (event: L.TileEvent): void => {
    if (!failedTiles.delete(event.tile)) return;
    syncTileFailure();
  };
  tiles.on('tileload', resolveTileFailure);
  tiles.on('tileunload', resolveTileFailure);
  tiles.addTo(map);

  const markerIcon = L.divIcon({
    className: 'report-map-marker',
    html: '<span class="report-map-marker-dot" aria-hidden="true"></span>',
    iconAnchor: [22, 22],
    iconSize: [44, 44],
  });

  let marker: L.Marker | null = null;
  let markerDragging = false;
  let expanded = false;
  /** What the form submits. */
  let committed: ReportCoordinates | null = null;
  /** What the marker shows. Equal to `committed` outside the expanded state. */
  let shown: ReportCoordinates | null = null;
  /** Bumped by every deliberate move, so a slow location refinement stands down. */
  let generation = 0;

  function announce(coordinates: ReportCoordinates, fix?: ReportFix): void {
    const metres = fix ? accuracyMetres(fix.accuracy) : null;
    const accuracy =
      metres === null ? '' : ` ${options.strings.mapAccuracy.replace('{metres}', String(metres))}`;
    mapStatus.textContent = `${options.strings.mapSelected} ${coordinateText(coordinates)}${accuracy}`;
  }

  function selectedCoordinates(lat: number, lon: number): ReportCoordinates | null {
    const coordinates = { lat, lon };
    return finiteCoordinates(coordinates) ? coordinates : null;
  }

  /** Moves the pin. Nothing here reaches the form; `commit` does that. */
  function place(coordinates: ReportCoordinates | null, recenter = false): void {
    shown = coordinates;
    if (!coordinates) {
      marker?.remove();
      marker = null;
      syncBar();
      return;
    }
    const latLng = L.latLng(coordinates.lat, coordinates.lon);
    if (marker) {
      marker.setLatLng(latLng);
    } else {
      marker = L.marker(latLng, {
        autoPan: true,
        bubblingMouseEvents: false,
        draggable: true,
        icon: markerIcon,
        keyboard: true,
        title: options.strings.mapMarkerLabel,
      }).addTo(map);
      marker.on('dragstart', () => {
        markerDragging = true;
      });
      marker.on('dragend', () => {
        const point = marker?.getLatLng();
        const next = point ? selectedCoordinates(point.lat, point.lng) : null;
        if (next) select(next);
        window.setTimeout(() => {
          markerDragging = false;
        }, 0);
      });
    }
    if (recenter) {
      map.setView(latLng, Math.max(LOCATION_ZOOM, map.getZoom()), { animate: !reducedMotion });
    }
    syncBar();
  }

  /** Hands the point to the form and says so out loud. */
  function commit(coordinates: ReportCoordinates | null, fix?: ReportFix): void {
    committed = coordinates;
    removePill.hidden = !coordinates;
    options.onCoordinatesChange(coordinates);
    if (coordinates) announce(coordinates, fix);
    else mapStatus.textContent = options.strings.mapCleared;
  }

  /**
   * A point the person chose. While the map is expanded it waits for the confirm
   * button; from the compact row there is nothing to wait for.
   */
  function select(coordinates: ReportCoordinates, recenter = false, fix?: ReportFix): void {
    generation += 1;
    place(coordinates, recenter);
    if (!expanded) commit(coordinates, fix);
    else announce(coordinates, fix);
  }

  /*
   * A point on the map is a choice between taking it away and keeping it; with
   * no point there is nothing to remove and one button closes the picker.
   */
  function syncBar(): void {
    const chosen = shown !== null;
    confirmButton.hidden = !chosen;
    removeButton.hidden = !chosen;
    closeButton.hidden = chosen;
    barElement.dataset.choice = chosen ? 'point' : 'none';
  }

  /** Takes the point away from the map and from the form in one move. */
  function removeLocation(): void {
    generation += 1;
    place(null);
    commit(null);
  }

  // ---- compact and expanded ------------------------------------------------

  function syncInteraction(): void {
    const handlers = [
      map.dragging,
      map.scrollWheelZoom,
      map.touchZoom,
      map.doubleClickZoom,
      map.boxZoom,
      map.keyboard,
    ];
    for (const handler of handlers) {
      if (!handler) continue;
      if (expanded) handler.enable();
      else handler.disable();
    }
    mapCanvas.tabIndex = expanded ? 0 : -1;
    openButton.hidden = expanded;
    openButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    barElement.hidden = !expanded;
  }

  /** Leaflet only learns a new size when it is told; the transition decides when. */
  function resizeAfterTransition(): void {
    let done = false;
    const settle = (): void => {
      if (done) return;
      done = true;
      map.invalidateSize({ animate: false });
      if (shown) {
        map.setView(L.latLng(shown.lat, shown.lon), map.getZoom(), { animate: false });
      }
    };
    if (reducedMotion) {
      settle();
      return;
    }
    const onEnd = (event: TransitionEvent): void => {
      if (event.target !== frame) return;
      frame.removeEventListener('transitionend', onEnd);
      settle();
    };
    frame.addEventListener('transitionend', onEnd);
    window.setTimeout(settle, EXPAND_FALLBACK_MS);
    window.setTimeout(() => map.invalidateSize({ animate: false }), EXPAND_MS / 2);
  }

  function expand(): void {
    if (expanded) return;
    expanded = true;
    root.dataset.expanded = 'true';
    syncInteraction();
    syncBar();
    resizeAfterTransition();
    (removeButton.hidden ? closeButton : removeButton).focus({ preventScroll: true });
  }

  function collapse(keep: boolean): void {
    if (!expanded) return;
    expanded = false;
    delete root.dataset.expanded;
    if (keep) commit(shown);
    else place(committed);
    syncInteraction();
    resizeAfterTransition();
    openButton.focus({ preventScroll: true });
  }

  openButton.addEventListener('click', expand);
  confirmButton.addEventListener('click', () => collapse(true));
  closeButton.addEventListener('click', () => collapse(false));
  removeButton.addEventListener('click', () => {
    removeLocation();
    collapse(false);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    collapse(false);
  });

  map.on('click', (event: L.LeafletMouseEvent) => {
    if (markerDragging || !expanded) return;
    const coordinates = selectedCoordinates(event.latlng.lat, event.latlng.lng);
    if (coordinates) select(coordinates);
  });

  canvas.addEventListener('keydown', (event) => {
    if (!expanded || event.target !== mapCanvas || (event.key !== 'Enter' && event.key !== ' '))
      return;
    event.preventDefault();
    const center = map.getCenter();
    const coordinates = selectedCoordinates(center.lat, center.lng);
    if (coordinates) select(coordinates);
  });

  /* The pill hides itself once the point is gone, so the focus moves next door. */
  removePill.addEventListener('click', () => {
    removeLocation();
    locateButton.focus({ preventScroll: true });
  });

  // ---- "Moja lokacija" -----------------------------------------------------

  function endLocating(): void {
    locateButton.disabled = false;
    locateButton.removeAttribute('aria-busy');
  }

  locateButton.addEventListener('click', () => {
    if (!window.isSecureContext) {
      mapStatus.textContent = options.strings.mapInsecure;
      return;
    }
    if (!navigator.geolocation) {
      mapStatus.textContent = options.strings.mapLocationError;
      return;
    }

    locateButton.disabled = true;
    locateButton.setAttribute('aria-busy', 'true');
    mapStatus.textContent = options.strings.locating;

    const geolocation = navigator.geolocation;
    /*
     * Our own moves advance the generation as well, so remember the last one we
     * made: a refinement then moves the marker only if nothing else did in the
     * meantime.
     */
    let ours = generation;
    void locateBestEffort(
      (onSuccess, onError, positionOptions) =>
        geolocation.getCurrentPosition(onSuccess, onError, positionOptions),
      (fix) => {
        if (generation !== ours) return;
        select(fix, true, fix);
        ours = generation;
      },
    ).then((outcome) => {
      endLocating();
      if (outcome.kind === 'denied') mapStatus.textContent = options.strings.mapLocationDenied;
      else if (outcome.kind === 'failed') mapStatus.textContent = options.strings.mapLocationError;
    });
  });

  syncInteraction();
  syncBar();
  root.dataset.ready = 'true';
}
