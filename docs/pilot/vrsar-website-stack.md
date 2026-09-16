# vrsar.hr: how the municipal site is built and published

**Retrieved:** 2026-09-12, from public responses of `https://www.vrsar.hr` only (HTTP headers, HTML, theme assets, the public WordPress REST index, plugin readme files). No login, no municipal contact, no authorization. This is a research record for planning the Polis handover material; it records no municipal participation or agreement.

## Findings

| Item | Value | Evidence |
| --- | --- | --- |
| CMS | WordPress core 7.1 | `x-redirect-by: WordPress` header; `<generator>` in `/feed/`; `/wp-json/` index |
| Editor | Classic Editor plugin 1.6.7, in use | `plugins/classic-editor/readme.txt` served; post bodies from `/wp-json/wp/v2/posts` carry no `<!-- wp: -->` block markup, only `<p>`, `<strong>`, `<a>`, `<br />` |
| Theme | `opcina-vrsar`, "EA93 Wordpress Webpack Theme" 1.0.2 by EuroART93 (Zagreb agency) | `themes/opcina-vrsar/style.css` header; custom REST namespace `wp/ea/` |
| Theme build | Webpack bundle: jQuery, Swiper, GSAP, lightGallery, Axios, Vue fragments | `public/js/app.js` (726 KB), `vendor.css` |
| Custom fields | ACF Pro 6.6.2 | plugin readme; `acf` key on posts (empty for news) |
| Other plugins | Yoast SEO 26.3, EWWW Image Optimizer 8.2.1 (WebP), UserWay accessibility widget 2.6.5, Crop Thumbnails 1.9.6 | REST namespaces and readme files |
| Hosting | LiteSpeed web server, HTTP/2 and HTTP/3, no page-cache plugin | `server: LiteSpeed`, `x-turbo-charged-by`, `litespeed-cache` readme 404 |
| Languages | Croatian only. No `hreflang`, no `/en/` or `/it/` routes | homepage HTML |
| Public REST API | Open read: posts, pages, media, categories. Write needs an Application Password (enabled) | `/wp-json/` `authentication` |
| News | Standard `post` type; most posts sit in `Uncategorized` (878), `Administracija` (187). Homepage shows the latest posts as cards (image 384x230, title, date, excerpt) | `/wp-json/wp/v2/categories`, homepage markup |
| Permanent pages | `/za-gradane/...` hub (obrasci, informiranje javnosti, zaštita osobnih podataka), `/kontakt/` (e-mail, two phone numbers, no form plugin) | page sitemap, `/kontakt/` |
| Contact forms | None. The only `<form>` elements are site search | `/kontakt/` HTML |

Not verified: whether the municipality edits the site itself or through EuroART93; who holds admin; whether the LiteSpeed server cache is on.

## How a post gets published

1. An editor logs in at `/wp-admin/`, opens **Objave → Dodaj novu** (Classic Editor).
2. The **Tekst** tab accepts raw HTML. Inline `style` attributes and `<div>` blocks survive for Editor and Administrator roles.
3. Title goes in the title field, the body in the editor, a featured image (news card crops to 384x230, 60% ratio) in **Istaknuta slika**.
4. Publish. The post appears on the homepage news strip and at `/<slug>/`. Yoast generates the share metadata.

The same HTML pasted into a **page** under `/za-gradane/` gives the permanent entry; a news post scrolls off the homepage within weeks.

## What the theme does to post HTML

Post bodies render inside `.user-content` (single-column, black text on white, Lufga font). Rules that matter for handover HTML:

- `h2`–`h4` Lufga Bold 28/26/24 px; `p` and `li` 16 px, line height 1.714.
- `a`: blue `#0030d9`, animated underline on hover, and `word-break: break-all` (long raw URLs break mid-word; use link text, not bare URLs).
- `ul li` gets a blue dot, `ol li` a blue counter. No list-style needed.
- `table` is set to `display: flex; width: 90vw`. Tables break. Do not use them.
- `.button-1` (global): cyan `#66dbff` pill, radius 24 px, padding 8x24. Usable inside a post; add inline padding for a large tap target.
- Theme breakpoints: 480, 800, 1000, 1200 px. Content column is fluid, so plain block markup reflows on phones.
- `<meta name="format-detection" content="telephone=no">`: phone numbers are not auto-linked. Every number needs an explicit `tel:` link.
- Fonts load with `font-display: swap`; old devices fall back to sans-serif without layout change.

Implication: handover material must be plain semantic HTML (`h2`, `p`, `ul`, `ol`, `strong`, `a`, `div` with inline style), one block per line with blank lines between blocks so `wpautop` does not insert stray `<br>`.

## Integration options this stack allows

| Option | Needs | Note |
| --- | --- | --- |
| O1 Pasted announcement post | Editor pastes `vrsar-announcement-post.html` into the Tekst tab | Zero technical dependency on Polis. Draft in this folder. |
| O2 Permanent page under `/za-gradane/` | Same paste into a page; nav item added by the agency or an admin | Recommended alongside O1. |
| O3 Polis publishes status digests | Application Password for an Editor account, `POST /wp-json/wp/v2/posts` | Later. Municipality controls the account and can revoke it. |
| O4 Polis case embed | oEmbed provider registration in the theme (`wp_oembed_add_provider`) | Requires EuroART93. Not needed for launch. |
| O5 Widget on every page | Theme footer change | Requires EuroART93. Not needed for launch. |

O1 and O2 need nothing from the agency. O3 to O5 are second-phase.
