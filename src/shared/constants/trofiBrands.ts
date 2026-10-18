/**
 * TROFI brand portfolio — data source for the brand gallery
 * (`src/app/landing/components/TrofiBrands.tsx`, route `/brands`).
 *
 * Reference: https://www.troficorp.com/ ("TROFI Brands" section).
 *
 * Every entry records WHERE its destination was verified so no URL is ever
 * invented. Link resolution order (see `resolveBrandDestination`):
 *   1. a dedicated brand page on troficorp.com (`trofiPageUrl`)
 *   2. the brand's own official website (`officialUrl`)
 *   3. a verified official social / ordering page (`socialUrl`)
 *   4. none → the card renders as a non-link and is labelled unavailable.
 *
 * Images live in `public/brands/<id>.webp`. `image: null` means the original
 * asset could not be retrieved yet; the card then renders a typographic tile
 * (never a substitute or generated logo). Drop the real file in and set
 * `image` to its path — nothing else needs to change.
 */

export type BrandDestinationKind = "trofi-page" | "official-site" | "social" | "unavailable";

export interface TrofiBrand {
  /** Stable slug, also the image basename (`public/brands/<id>.webp`). */
  id: string;
  name: string;
  /** Optional native-script name shown under the Latin name. */
  nativeName?: string;
  /** Short category / cuisine label shown on the card. */
  category: string;
  /** Cities or markets the brand operates in. */
  location: string;
  /** One-line description paraphrased from TROFI's own brand copy. */
  description: string;
  /** Public path under `/public`, or null while the asset is pending. */
  image: string | null;
  /** Descriptive alt text used when `image` is set. */
  alt: string;
  /** Dedicated brand page on troficorp.com, when one was verified. */
  trofiPageUrl?: string;
  /** Brand's own standalone website, when verified. */
  officialUrl?: string;
  /** Verified official social or ordering page. */
  socialUrl?: string;
  /** How / where each URL was verified. Kept for auditability. */
  verification: string;
}

export interface BrandDestination {
  kind: BrandDestinationKind;
  url: string | null;
}

const TROFI = "https://www.troficorp.com";

export const TROFI_HOMEPAGE_URL = `${TROFI}/`;

export const TROFI_BRANDS: readonly TrofiBrand[] = [
  {
    id: "bait-mubarak",
    name: "Bait Mubarak",
    nativeName: "بيت مبارك",
    category: "Saudi heritage dining",
    location: "Riyadh",
    description:
      "The group's origin: a traditional Najdi mud-brick house serving Saudi cuisine, founded by Tariq Altuwaijri.",
    image: "/brands/bait-mubarak.webp",
    alt: "Bait Mubarak: a traditional Najdi mud-brick building with a decorated wooden gate and the Bait Mubarak logo",
    trofiPageUrl: `${TROFI}/ourstory`,
    verification:
      "troficorp.com/ourstory names Bait Mubarak as TROFI's origin (search-indexed). No dedicated brand page, website or social account could be verified; the Our Story page is the only verified destination. Image supplied by the project owner.",
  },
  {
    id: "gunbun",
    name: "GUNBUN",
    category: "Josper-grilled burgers",
    location: "Riyadh",
    description:
      "Expert chefs and a Josper oven deliver rich, grill-inspired burgers on sourdough buns. 2023 Best Recommended Burger in Riyadh.",
    image: null,
    alt: "GUNBUN logo",
    socialUrl: "https://www.instagram.com/gunbun.ksa/",
    verification:
      "Listed on the troficorp.com homepage; opening announced at troficorp.com/post/gunbun-riyadh-opens. Instagram @gunbun.ksa confirmed by Time Out Riyadh and TripTap listings. No standalone website found.",
  },
  {
    id: "chestnut",
    name: "Chestnut Bakery",
    category: "Artisan bakery",
    location: "London · Riyadh",
    description:
      "Revives the golden age of breadmaking; winner of Time Out Riyadh's 2023 Bakery & Patisserie award and the first Best Croissant UK award.",
    image: null,
    alt: "Chestnut Bakery logo",
    officialUrl: "https://www.chestnutbakery.com/",
    socialUrl: "https://www.instagram.com/chestnut.bakery/",
    verification:
      "Listed on the troficorp.com homepage; press at troficorp.com/post/time-out-riyadh-restaurant-awards-chestnut-2023. Official site chestnutbakery.com confirmed by its own pages and Time Out Riyadh.",
  },
  {
    id: "habra",
    name: "Habra",
    category: "Beef canteen & steakhouse",
    location: "Riyadh · Kuwait",
    description:
      'A beef canteen by Chef Ahmed Al Bader, named for "the best cut" and built around top-quality meats.',
    image: null,
    alt: "Habra logo",
    officialUrl: "https://habra.sa/",
    socialUrl: "https://www.instagram.com/habraksa/",
    verification:
      "Listed on the troficorp.com homepage. habra.sa and Instagram @habraksa confirmed by Gault&Millau and World's 50 Best Discovery listings for the Riyadh branch.",
  },
  {
    id: "lunch-room",
    name: "Lunch Room",
    category: "All-day dining",
    location: "Riyadh",
    description:
      "An all-day dining concept by Chef Ahmed Al Bader that celebrates lunch as a pause and ritual, extended into breakfast, brunch and dinner.",
    image: null,
    alt: "Lunch Room logo",
    trofiPageUrl: `${TROFI}/lunchroom`,
    officialUrl: "https://www.lunchroom.sa/",
    socialUrl: "https://www.instagram.com/lunchroomksa/",
    verification:
      "Dedicated page troficorp.com/lunchroom is search-indexed. Official site lunchroom.sa confirmed by Time Out Riyadh and World's 50 Best; Instagram @lunchroomksa cited by Arab News.",
  },
  {
    id: "fairuz-garden",
    name: "Fairuz Garden",
    category: "Mediterranean cloud kitchen",
    location: "Riyadh · Jeddah",
    description:
      "A Mediterranean-inspired cloud kitchen offering refined bite-sized delights made for gatherings.",
    image: null,
    alt: "Fairuz Garden logo",
    socialUrl: "https://www.instagram.com/fairuzgarden/",
    verification:
      "Listed on the troficorp.com homepage. Instagram @fairuzgarden (فيروز جاردن, delivery in Riyadh and Jeddah) is the best match found; no dedicated TROFI page or website verified — treat as medium confidence.",
  },
  {
    id: "nagwa",
    name: "Nagwa",
    nativeName: "نقوة",
    category: "Kuwaiti sweets & gifting",
    location: "Kuwait · Riyadh",
    description:
      "Started in 2004 from a personal need to gift local Kuwaiti sweets abroad; known for its food-gifting focus and packaging.",
    image: null,
    alt: "Nagwa logo",
    trofiPageUrl: `${TROFI}/nagwa`,
    officialUrl: "https://www.nagwaboutique.com/",
    verification:
      "Dedicated page troficorp.com/nagwa is search-indexed. Official site nagwaboutique.com (factories in Kuwait and Saudi Arabia) confirmed from its own pages.",
  },
  {
    id: "woop",
    name: "WOOP!",
    category: "Juice bar & café",
    location: "Kuwait · Saudi Arabia",
    description:
      "Fresh smoothies, fruit juices, soft-serve and waffles; TROFI reports WOOP forging new trends in Saudi Arabia.",
    image: null,
    alt: "WOOP! logo",
    trofiPageUrl: `${TROFI}/woop`,
    socialUrl: "https://www.instagram.com/woop.kw/",
    verification:
      "troficorp.com/woop listed as the brand website in the Culinary Agents Trofi Corp directory. Instagram @woop.kw confirmed by Kuwait directory listings.",
  },
  {
    id: "the-gentlemen-baristas",
    name: "The Gentlemen Baristas",
    category: "Specialty coffee",
    location: "London",
    description:
      'Specialty coffee houses and roastery serving London since 2014; featured as "Local Heroes" by The Sunday Times.',
    image: null,
    alt: "The Gentlemen Baristas logo",
    officialUrl: "https://www.thegentlemenbaristas.com/",
    verification:
      "Multiple TROFI posts (e.g. troficorp.com/post/the-gentlemen-baristas-opens-flagship-store-in-piccadilly-london). Official site thegentlemenbaristas.com confirmed from its own pages and directory listings.",
  },
  {
    id: "over-jar",
    name: "Over Jar",
    category: "Belgian chocolate concept",
    location: "Riyadh",
    description:
      "A chocolate concept that triggers your five senses with pure melted Belgian chocolate.",
    image: null,
    alt: "Over Jar logo",
    trofiPageUrl: `${TROFI}/overjar`,
    socialUrl: "https://www.instagram.com/overjarksa/",
    verification:
      "Dedicated page troficorp.com/overjar is search-indexed and listed as the brand website by Culinary Agents; Instagram @overjarksa from the same listing.",
  },
  {
    id: "the-levant-bakery",
    name: "The Levant Bakery",
    category: "Middle-Eastern bakery",
    location: "Riyadh",
    description: "Established in 2022 as a Middle-Eastern bakery.",
    image: null,
    alt: "The Levant Bakery logo",
    trofiPageUrl: `${TROFI}/thelevantbakery`,
    verification:
      "Dedicated page troficorp.com/thelevantbakery is search-indexed. No official website or social account could be verified (the @thelevantbakery Instagram handle belongs to an unrelated US bakery).",
  },
  {
    id: "almajlis-alkhaleeji",
    name: "Almajlis Alkhaleeji",
    nativeName: "المجلس الخليجي",
    category: "Pan-Arabic Gulf cuisine",
    location: "Riyadh",
    description:
      "Authentic menus from Saudi Arabia, Kuwait, Oman, Bahrain and the UAE in an upscale-casual Gulf majlis setting.",
    image: null,
    alt: "Almajlis Alkhaleeji logo",
    trofiPageUrl: `${TROFI}/almajlisalkhaleeji`,
    officialUrl: "https://www.almajles.sa/en",
    socialUrl: "https://www.instagram.com/almajlis_alkhaleeji/",
    verification:
      "Dedicated page troficorp.com/almajlisalkhaleeji is search-indexed. Official site almajles.sa and Instagram @almajlis_alkhaleeji confirmed by matching phone number and address.",
  },
  {
    id: "century-burger",
    name: "Century Burger",
    category: "Handcrafted burgers since 2011",
    location: "Jeddah · Riyadh · Taif · Makkah · Qassim",
    description:
      "Saudi Arabia's first handcrafted burger joint, built on freshly minced patties and house-baked buns.",
    image: null,
    alt: "Century Burger logo",
    officialUrl: "https://www.centuryburger.com/",
    socialUrl: "https://www.instagram.com/centuryburger/",
    verification:
      "Described on troficorp.com/home-1-1-2-1 and listed under Trofi Corp by Culinary Agents. Official site centuryburger.com and Instagram @centuryburger confirmed from the brand's own homepage.",
  },
  {
    id: "one-of",
    name: "One Of",
    category: "Burger delivery concept",
    location: "Riyadh",
    description: "A delivery concept built around one-of-a-kind burgers.",
    image: null,
    alt: "One Of logo",
    trofiPageUrl: `${TROFI}/oneof`,
    verification:
      "Dedicated page troficorp.com/oneof is search-indexed. No official website or social account could be verified.",
  },
];

/**
 * Picks the card's click-through destination using the documented priority
 * (TROFI brand page → official site → social). Never falls back to the TROFI
 * homepage: a brand with nothing verified is reported as `unavailable`.
 */
export function resolveBrandDestination(brand: TrofiBrand): BrandDestination {
  if (brand.trofiPageUrl) return { kind: "trofi-page", url: brand.trofiPageUrl };
  if (brand.officialUrl) return { kind: "official-site", url: brand.officialUrl };
  if (brand.socialUrl) return { kind: "social", url: brand.socialUrl };
  return { kind: "unavailable", url: null };
}

/**
 * Secondary links shown under the card (everything verified that is not the
 * primary destination), so a visitor can still reach the official site when
 * the primary is the TROFI brand page.
 */
export function secondaryBrandLinks(
  brand: TrofiBrand
): Array<{ kind: Exclude<BrandDestinationKind, "unavailable">; url: string }> {
  const primary = resolveBrandDestination(brand).url;
  const candidates: Array<{ kind: Exclude<BrandDestinationKind, "unavailable">; url?: string }> = [
    { kind: "trofi-page", url: brand.trofiPageUrl },
    { kind: "official-site", url: brand.officialUrl },
    { kind: "social", url: brand.socialUrl },
  ];
  return candidates.filter(
    (c): c is { kind: Exclude<BrandDestinationKind, "unavailable">; url: string } =>
      Boolean(c.url) && c.url !== primary
  );
}

/** Hostname label for a URL ("instagram.com", "chestnutbakery.com"). */
export function brandLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
