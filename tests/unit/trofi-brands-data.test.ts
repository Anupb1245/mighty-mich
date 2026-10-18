/**
 * Guards for the TROFI brand gallery data (`src/shared/constants/trofiBrands.ts`):
 * every brand is unique, every destination is a real https URL that was
 * verified (never the TROFI homepage as a stand-in), every referenced image
 * exists under `public/`, and the link-resolution priority is honoured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

const {
  TROFI_BRANDS,
  TROFI_HOMEPAGE_URL,
  brandLinkHost,
  resolveBrandDestination,
  secondaryBrandLinks,
} = await import("../../src/shared/constants/trofiBrands.ts");

const PUBLIC_DIR = join(process.cwd(), "public");

test("brand ids and names are unique and well-formed", () => {
  const ids = TROFI_BRANDS.map((b) => b.id);
  const names = TROFI_BRANDS.map((b) => b.name.toLowerCase());
  assert.equal(new Set(ids).size, ids.length, "duplicate brand id");
  assert.equal(new Set(names).size, names.length, "duplicate brand name");
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad slug: ${id}`);
  assert.ok(TROFI_BRANDS.length >= 14, "expected the full discovered brand list");
});

test("every brand carries the fields the card renders", () => {
  for (const b of TROFI_BRANDS) {
    assert.ok(b.name.trim(), `${b.id}: name`);
    assert.ok(b.category.trim(), `${b.id}: category`);
    assert.ok(b.location.trim(), `${b.id}: location`);
    assert.ok(b.description.trim(), `${b.id}: description`);
    assert.ok(b.alt.trim(), `${b.id}: alt text`);
    assert.ok(b.verification.trim().length > 20, `${b.id}: verification note`);
  }
});

test("destination URLs are https, brand-specific and never the TROFI homepage", () => {
  const seen = new Map<string, string>();
  for (const b of TROFI_BRANDS) {
    for (const url of [b.trofiPageUrl, b.officialUrl, b.socialUrl]) {
      if (!url) continue;
      const parsed = new URL(url);
      assert.equal(parsed.protocol, "https:", `${b.id}: ${url} must be https`);
      assert.notEqual(url, TROFI_HOMEPAGE_URL, `${b.id}: homepage is not a brand destination`);
      assert.notEqual(
        url.replace(/\/$/, ""),
        TROFI_HOMEPAGE_URL.replace(/\/$/, ""),
        `${b.id}: homepage is not a brand destination`
      );
      const owner = seen.get(url);
      assert.ok(!owner || owner === b.id, `${url} is shared by ${owner} and ${b.id}`);
      seen.set(url, b.id);
    }
    if (b.trofiPageUrl) {
      assert.match(b.trofiPageUrl, /^https:\/\/www\.troficorp\.com\/[a-z0-9-]+$/i, b.id);
    }
  }
});

test("link resolution follows TROFI page → official site → social → unavailable", () => {
  for (const b of TROFI_BRANDS) {
    const dest = resolveBrandDestination(b);
    if (b.trofiPageUrl) assert.deepEqual(dest, { kind: "trofi-page", url: b.trofiPageUrl });
    else if (b.officialUrl) assert.deepEqual(dest, { kind: "official-site", url: b.officialUrl });
    else if (b.socialUrl) assert.deepEqual(dest, { kind: "social", url: b.socialUrl });
    else assert.deepEqual(dest, { kind: "unavailable", url: null });

    const secondary = secondaryBrandLinks(b);
    for (const link of secondary) assert.notEqual(link.url, dest.url);
    const expectedCount = [b.trofiPageUrl, b.officialUrl, b.socialUrl].filter(Boolean).length;
    assert.equal(secondary.length, Math.max(0, expectedCount - 1), b.id);
  }
  assert.deepEqual(
    resolveBrandDestination({
      id: "x",
      name: "x",
      category: "c",
      location: "l",
      description: "d",
      image: null,
      alt: "a",
      verification: "none verified",
    }),
    { kind: "unavailable", url: null }
  );
});

test("referenced brand images exist under public/ with the brand's slug", () => {
  let withImage = 0;
  for (const b of TROFI_BRANDS) {
    if (!b.image) continue;
    withImage += 1;
    assert.equal(b.image, `/brands/${b.id}.webp`, `${b.id}: image path convention`);
    assert.ok(existsSync(join(PUBLIC_DIR, b.image)), `${b.id}: missing ${b.image}`);
  }
  assert.ok(withImage >= 1, "at least one real brand asset is shipped");
});

test("brandLinkHost strips www and tolerates garbage", () => {
  assert.equal(brandLinkHost("https://www.chestnutbakery.com/"), "chestnutbakery.com");
  assert.equal(brandLinkHost("https://www.instagram.com/gunbun.ksa/"), "instagram.com");
  assert.equal(brandLinkHost("not a url"), "not a url");
});
