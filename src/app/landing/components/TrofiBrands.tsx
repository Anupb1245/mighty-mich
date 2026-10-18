"use client";
import { useTranslations } from "next-intl";
import {
  TROFI_BRANDS,
  TROFI_HOMEPAGE_URL,
  brandLinkHost,
  resolveBrandDestination,
  secondaryBrandLinks,
  type BrandDestinationKind,
  type TrofiBrand,
} from "@/shared/constants/trofiBrands";

const KIND_LABEL_KEY: Record<Exclude<BrandDestinationKind, "unavailable">, string> = {
  "trofi-page": "brandsKindTrofiPage",
  "official-site": "brandsKindOfficialSite",
  social: "brandsKindSocial",
};

const KIND_ICON: Record<Exclude<BrandDestinationKind, "unavailable">, string> = {
  "trofi-page": "storefront",
  "official-site": "language",
  social: "photo_camera",
};

function BrandImage({ brand }: { brand: TrofiBrand }) {
  const t = useTranslations("landing");
  if (brand.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static asset, next/image is unoptimized in this app
      <img
        src={brand.image}
        alt={brand.alt}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
      />
    );
  }
  // No original asset retrieved yet: a typographic tile, never a substitute logo.
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center transition-transform duration-500 ease-out group-hover:scale-105"
      data-testid="brand-image-pending"
    >
      <span className="text-2xl sm:text-3xl font-black tracking-tight text-[#2B2117]">
        {brand.name}
      </span>
      {brand.nativeName && (
        <span className="text-base text-[#6B5C4A]" dir="rtl" lang="ar">
          {brand.nativeName}
        </span>
      )}
      <span className="mt-2 rounded-full border border-[#D9CDBE] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#8A7A66]">
        {t("brandsImagePending")}
      </span>
    </div>
  );
}

function BrandCard({ brand }: { brand: TrofiBrand }) {
  const t = useTranslations("landing");
  const destination = resolveBrandDestination(brand);
  const secondary = secondaryBrandLinks(brand);
  const unavailableId = `brand-${brand.id}-unavailable`;

  const body = (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-[#F3EFE8]">
        <BrandImage brand={brand} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-base font-bold leading-tight text-white group-hover:text-[#E54D5E] transition-colors">
          {brand.name}
        </h3>
        {brand.nativeName && brand.image && (
          <p className="text-sm text-gray-400" dir="rtl" lang="ar">
            {brand.nativeName}
          </p>
        )}
        <p className="text-xs font-medium uppercase tracking-wider text-[#E54D5E]/90">
          {brand.category}
        </p>
        <p className="text-xs text-gray-500">{brand.location}</p>
        <p className="mt-2 text-sm text-gray-400 line-clamp-3">{brand.description}</p>
      </div>
    </>
  );

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-[#2D333B] bg-[#111520] transition-all duration-300 hover:-translate-y-1 hover:border-[#E54D5E]/50 hover:shadow-[0_12px_40px_rgba(229,77,94,0.18)] focus-within:border-[#E54D5E]/60"
      data-brand-id={brand.id}
    >
      {destination.url ? (
        <a
          href={destination.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t("brandsVisit", { name: brand.name })} (${t("brandsOpensNewTab")})`}
          className="flex flex-1 flex-col outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-[#E54D5E] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
        >
          {body}
        </a>
      ) : (
        <div className="flex flex-1 flex-col" aria-describedby={unavailableId}>
          {body}
        </div>
      )}

      <div className="relative z-10 flex flex-wrap items-center gap-2 border-t border-[#2D333B] px-4 py-3">
        {destination.url ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              {KIND_ICON[destination.kind as Exclude<BrandDestinationKind, "unavailable">]}
            </span>
            <span>{brandLinkHost(destination.url)}</span>
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              open_in_new
            </span>
          </span>
        ) : (
          <span
            id={unavailableId}
            className="inline-flex items-center gap-1 text-xs text-amber-400/90"
            data-testid="brand-link-unavailable"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              link_off
            </span>
            {t("brandsLinkUnavailable")}
          </span>
        )}
        {secondary.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${brand.name}: ${t(KIND_LABEL_KEY[link.kind])} (${t("brandsOpensNewTab")})`}
            title={t(KIND_LABEL_KEY[link.kind])}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#2D333B] px-2 py-0.5 text-[11px] text-gray-400 transition-colors hover:border-[#E54D5E]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E54D5E]"
          >
            <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
              {KIND_ICON[link.kind]}
            </span>
            {brandLinkHost(link.url)}
          </a>
        ))}
      </div>
    </article>
  );
}

export default function TrofiBrands() {
  const t = useTranslations("landing");

  return (
    <section className="py-24 px-4 sm:px-6" id="brands" aria-labelledby="brands-heading">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#E54D5E]">
              {t("brandsEyebrow")}
            </p>
            <h2 id="brands-heading" className="text-3xl md:text-4xl font-bold break-words">
              {t("brandsTitle")}
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-gray-400">{t("brandsSubtitle")}</p>
          </div>
          <a
            href={TROFI_HOMEPAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-gray-300 transition-colors hover:text-white md:self-auto"
          >
            {t("brandsSource")}
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              open_in_new
            </span>
          </a>
        </div>

        <ul
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label={t("brandsEyebrow")}
        >
          {TROFI_BRANDS.map((brand) => (
            <li key={brand.id} className="h-full">
              <BrandCard brand={brand} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
