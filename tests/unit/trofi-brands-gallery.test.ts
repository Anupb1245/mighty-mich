/**
 * Renders the TROFI brand gallery (`src/app/landing/components/TrofiBrands.tsx`)
 * server-side and checks the click behaviour the gallery promises: one card
 * per brand, each card a link to that brand's verified destination opening in
 * a new tab, accessible labels, a typographic fallback (not a substitute
 * logo) for brands whose asset is pending, and an explicit "unavailable"
 * state instead of a fabricated link.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

const { default: TrofiBrands } = await import("../../src/app/landing/components/TrofiBrands.tsx");
const { TROFI_BRANDS, TROFI_HOMEPAGE_URL, resolveBrandDestination } =
  await import("../../src/shared/constants/trofiBrands.ts");

const messages = JSON.parse(readFileSync("src/i18n/messages/en.json", "utf8"));

function render(): string {
  return renderToStaticMarkup(
    React.createElement(
      NextIntlClientProvider,
      { locale: "en", messages, timeZone: "UTC" },
      React.createElement(TrofiBrands)
    )
  );
}

function cardHtml(html: string, id: string): string {
  const start = html.indexOf(`data-brand-id="${id}"`);
  assert.ok(start >= 0, `card for ${id} rendered`);
  const end = html.indexOf("</article>", start);
  return html.slice(start, end);
}

test("renders one card per brand with its name and category", () => {
  const html = render();
  assert.equal(html.match(/data-brand-id="/g)?.length, TROFI_BRANDS.length);
  for (const b of TROFI_BRANDS) {
    const card = cardHtml(html, b.id);
    assert.ok(card.includes(b.name), `${b.id}: name`);
    assert.ok(card.includes(b.category), `${b.id}: category`);
  }
});

test("each card links to its own verified destination in a new tab", () => {
  const html = render();
  for (const b of TROFI_BRANDS) {
    const card = cardHtml(html, b.id);
    const dest = resolveBrandDestination(b);
    if (dest.url) {
      const anchor = card.match(/<a [^>]*href="([^"]+)"[^>]*>/);
      assert.ok(anchor, `${b.id}: primary anchor`);
      assert.equal(anchor![1], dest.url, `${b.id}: primary href`);
      assert.match(anchor![0], /target="_blank"/, `${b.id}: new tab`);
      assert.match(anchor![0], /rel="noopener noreferrer"/, `${b.id}: rel`);
      assert.match(anchor![0], new RegExp(`aria-label="Visit ${b.name.replace(/[!]/g, "$&")}`));
      assert.ok(!card.includes("brand-link-unavailable"), `${b.id}: not flagged unavailable`);
    } else {
      assert.ok(card.includes('data-testid="brand-link-unavailable"'), `${b.id}: flagged`);
      assert.ok(!/<a [^>]*href=/.test(card), `${b.id}: no fabricated link`);
    }
    // Secondary links never duplicate the primary destination.
    const hrefs = [...card.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(hrefs).size, hrefs.length, `${b.id}: duplicate hrefs`);
  }
});

test("no brand card points at the TROFI homepage", () => {
  const html = render();
  for (const b of TROFI_BRANDS) {
    const card = cardHtml(html, b.id);
    assert.ok(!card.includes(`href="${TROFI_HOMEPAGE_URL}"`), `${b.id}: homepage link`);
  }
});

test("shipped assets render as <img> with alt text; pending assets render a typographic tile", () => {
  const html = render();
  for (const b of TROFI_BRANDS) {
    const card = cardHtml(html, b.id);
    if (b.image) {
      assert.match(card, new RegExp(`<img[^>]*src="${b.image}"`), `${b.id}: img src`);
      assert.match(
        card,
        new RegExp(`<img[^>]*alt="${b.alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`)
      );
      assert.match(card, /loading="lazy"/);
      assert.ok(!card.includes("brand-image-pending"), `${b.id}: no pending tile`);
    } else {
      assert.ok(card.includes('data-testid="brand-image-pending"'), `${b.id}: pending tile`);
      assert.ok(!card.includes("<img"), `${b.id}: no substitute image`);
    }
  }
});

test("section is landmarked, labelled and lists brands for keyboard users", () => {
  const html = render();
  assert.match(html, /<section[^>]*id="brands"[^>]*aria-labelledby="brands-heading"/);
  assert.match(html, /<h2 id="brands-heading"/);
  assert.match(html, /<ul[^>]*aria-label="TROFI Brands"/);
  assert.equal(html.match(/<li /g)?.length, TROFI_BRANDS.length);
});
