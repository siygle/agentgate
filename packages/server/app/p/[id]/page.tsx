import prisma from "@/lib/prisma";
import { DiffViewer } from "@/components/diff-viewer";
import type { Metadata } from "next";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const diff = await prisma.diff.findUnique({ where: { id } });
  return { title: diff ? diff.title : "Diff" };
}

export default async function DiffPage({ params }: PageProps) {
  const { id } = await params;
  const diff = await prisma.diff.findUnique({ where: { id } });

  if (!diff || diff.expiredAt < new Date()) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <p className="text-2xl font-semibold text-stone-400 dark:text-stone-600">404</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">Diff not found or expired</p>
        </div>
      </div>
    );
  }

  const files = diff.files as Array<{
    filename: string;
    language?: string;
    patch: string;
  }>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100 truncate">
          {diff.title}
        </h1>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 font-mono">
          Expires {diff.expiredAt.toLocaleString()}
        </p>
      </div>
      <DiffViewer files={files} />
    </div>
  );
}
