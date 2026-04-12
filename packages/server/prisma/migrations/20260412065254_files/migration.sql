-- CreateTable
CREATE TABLE "file_bundles" (
    "id" TEXT NOT NULL,
    "encrypted_data" JSONB NOT NULL,
    "expired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_bundles_pkey" PRIMARY KEY ("id")
);
