// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Where a visit to a language root goes.
 *
 * The root used to be the place map. It now opens on "What is Polis?", and the
 * map lives at `/karta` (`/en/karta`). Old links into the map carry
 * `?zupanija=<slug>`, so those move on to the map with the query intact, as a
 * permanent redirect. A bare root visit goes to About with a temporary
 * redirect, so the landing can change later without browsers caching it.
 */

import { aboutHrefs, mapHrefs } from '../../content/chrome';
import type { Lang } from '../../content/public-release';

export interface RootRedirect {
  location: string;
  status: 301 | 302;
}

export function rootRedirect(url: URL, lang: Lang): RootRedirect {
  if (url.searchParams.has('zupanija')) {
    return { location: `${mapHrefs[lang]}${url.search}`, status: 301 };
  }
  return { location: `${aboutHrefs[lang]}${url.search}`, status: 302 };
}
