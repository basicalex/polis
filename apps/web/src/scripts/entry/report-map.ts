// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as L from 'leaflet';

/** One replaceable endpoint; browser requests keep normal cache and referrer behaviour. */
export const REPORT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const INITIAL_ZOOM = 15;
const LOCATION_ZOOM = 17;
const MAX_ZOOM = 19;

export interface ReportCoordinates {
  lat: number;
  lon: number;
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
  locating: string;
}

interface ReportMapOptions {
  center: ReportCoordinates;
  strings: ReportMapStrings;
  onCoordinatesChange: (coordinates: ReportCoordinates | null) => void;
}

function finiteCoordinates(coordinates: ReportCoordinates): boolean {
  return Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon);
}

function coordinateText(coordinates: ReportCoordinates): string {
  return `${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`;
}

/**
 * Adds the optional street-level picker without owning the filing form. If this
 * throws, report.ts leaves text, photo and submission behaviour running.
 */
export function initReportMap(root: HTMLElement, options: ReportMapOptions): void {
  const canvas = root.querySelector<HTMLElement>('[data-report-map-canvas]');
  const locate = root.querySelector<HTMLButtonElement>('[data-locate]');
  const clear = root.querySelector<HTMLButtonElement>('[data-clear-location]');
  const status = root.querySelector<HTMLElement>('[data-map-status]');
  const error = root.querySelector<HTMLElement>('[data-map-error]');
  if (!canvas || !locate || !clear || !status || !error || !finiteCoordinates(options.center)) {
    throw new Error('report_map_markup');
  }
  const clearButton = clear;
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
      position: 'topleft',
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

  function announce(coordinates: ReportCoordinates): void {
    mapStatus.textContent = `${options.strings.mapSelected} ${coordinateText(coordinates)}`;
  }

  function selectedCoordinates(lat: number, lon: number): ReportCoordinates | null {
    const coordinates = { lat, lon };
    return finiteCoordinates(coordinates) ? coordinates : null;
  }

  function select(coordinates: ReportCoordinates, recenter = false): void {
    if (!finiteCoordinates(coordinates)) return;
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
        if (point) {
          const next = selectedCoordinates(point.lat, point.lng);
          if (next) {
            options.onCoordinatesChange(next);
            announce(next);
          }
        }
        window.setTimeout(() => {
          markerDragging = false;
        }, 0);
      });
    }

    clearButton.hidden = false;
    options.onCoordinatesChange(coordinates);
    announce(coordinates);
    if (recenter) {
      map.setView(latLng, Math.max(LOCATION_ZOOM, map.getZoom()), { animate: !reducedMotion });
    }
  }

  map.on('click', (event: L.LeafletMouseEvent) => {
    if (markerDragging) return;
    const coordinates = selectedCoordinates(event.latlng.lat, event.latlng.lng);
    if (coordinates) select(coordinates);
  });

  canvas.addEventListener('keydown', (event) => {
    if (event.target !== canvas || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    const center = map.getCenter();
    const coordinates = selectedCoordinates(center.lat, center.lng);
    if (coordinates) select(coordinates);
  });

  clearButton.addEventListener('click', () => {
    marker?.remove();
    marker = null;
    clearButton.hidden = true;
    options.onCoordinatesChange(null);
    mapStatus.textContent = options.strings.mapCleared;
    canvas.focus({ preventScroll: true });
  });

  locateButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      mapStatus.textContent = options.strings.mapLocationError;
      return;
    }

    locateButton.disabled = true;
    locateButton.setAttribute('aria-busy', 'true');
    mapStatus.textContent = options.strings.locating;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locateButton.disabled = false;
        locateButton.removeAttribute('aria-busy');
        const coordinates = selectedCoordinates(position.coords.latitude, position.coords.longitude);
        if (coordinates) select(coordinates, true);
        else mapStatus.textContent = options.strings.mapLocationError;
      },
      (locationError) => {
        locateButton.disabled = false;
        locateButton.removeAttribute('aria-busy');
        mapStatus.textContent =
          locationError.code === locationError.PERMISSION_DENIED
            ? options.strings.mapLocationDenied
            : options.strings.mapLocationError;
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
    );
  });

  root.dataset.ready = 'true';
}
