/*
  Warnings:

  - You are about to drop the column `files` on the `diffs` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `diffs` table. All the data in the column will be lost.
  - Added the required column `encrypted_data` to the `diffs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "diffs" DROP COLUMN "files",
DROP COLUMN "title",
ADD COLUMN     "encrypted_data" JSONB NOT NULL;
