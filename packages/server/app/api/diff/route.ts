import { ok, err } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { customAlphabet } from "nanoid";
import { z } from "zod";

const generateId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

const createDiffSchema = z.object({
  title: z.string().min(1),
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        language: z.string().optional(),
        patch: z.string().min(1),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createDiffSchema.safeParse(body);

    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { title, files } = parsed.data;
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const id = generateId();

    const diff = await prisma.diff.create({
      data: { id, title, files, expiredAt },
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

    return ok({ preview_url: `${baseUrl}/p/${diff.id}`, id: diff.id }, 201);
  } catch {
    return err("Internal server error", 500);
  }
}
