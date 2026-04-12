import prisma from "@/lib/prisma";
import { FileDecryptViewer } from "@/components/file-decrypt-viewer";
import type { Metadata } from "next";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const bundle = await prisma.fileBundle.findUnique({ where: { id } });
  return { title: bundle ? "Encrypted Files" : "Files" };
}

export default async function FilesPage({ params }: PageProps) {
  const { id } = await params;
  const bundle = await prisma.fileBundle.findUnique({ where: { id } });

  if (!bundle || bundle.expiredAt < new Date()) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <p className="text-2xl font-semibold text-stone-400 dark:text-stone-600">404</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">Files not found or expired</p>
        </div>
      </div>
    );
  }

  const encryptedData = bundle.encryptedData as {
    ciphertext: string;
    iv: string;
    salt: string;
  };

  return (
    <FileDecryptViewer
      encryptedData={encryptedData}
      expiresAt={bundle.expiredAt.toISOString()}
    />
  );
}
