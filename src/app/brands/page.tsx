import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import TrofiBrands from "@/app/landing/components/TrofiBrands";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return {
    title: t("brandsPageTitle"),
    description: t("brandsSubtitle"),
  };
}

export default async function BrandsPage() {
  const t = await getTranslations("landing");

  return (
    <main className="min-h-screen bg-[#0B0E14] text-white antialiased">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10">
        <Link
          href="/landing"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_back
          </span>
          {t("brandsBackToHome")}
        </Link>
      </div>
      <TrofiBrands />
    </main>
  );
}
