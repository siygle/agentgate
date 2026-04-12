import { source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";

function docsPath(slug: string[] | undefined): string {
  if (!slug?.length) return "/docs";
  return `/docs/${slug.join("/")}`;
}

function siteOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const title = page.data.title;
  const description = page.data.description;
  const path = docsPath(params.slug);
  const canonicalUrl = `${siteOrigin()}${path}`;
  const openGraphTitle = `${title} | diff4 Docs`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: openGraphTitle,
      description,
      url: canonicalUrl,
      siteName: "diff4",
      type: "article",
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title: openGraphTitle,
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
