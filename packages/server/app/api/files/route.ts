import { ok, err } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { getPostHogClient } from "@/lib/posthog-server";

const generateId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

const createFilesSchema = z.object({
  encrypted_data: z.object({
    ciphertext: z.string().min(1),
    iv: z.string().min(1),
    salt: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createFilesSchema.safeParse(body);

    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { encrypted_data } = parsed.data;
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const id = generateId();

    const bundle = await prisma.fileBundle.create({
      data: { id, encryptedData: encrypted_data, expiredAt },
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: bundle.id,
      event: "files_created",
      properties: {
        bundle_id: bundle.id,
        expires_at: expiredAt.toISOString(),
      },
    });

    return ok({ preview_url: `${baseUrl}/f/${bundle.id}`, id: bundle.id }, 201);
  } catch {
    return err("Internal server error", 500);
  }
}
