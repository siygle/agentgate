-- D1-only storage mode: when R2 is disabled (USE_R2 != "true"), the encrypted
-- blob is stored directly in this column instead of R2. Nullable: R2-mode rows
-- leave it NULL and keep the blob in R2 (referenced by r2_key).

ALTER TABLE diffs ADD COLUMN encrypted_data TEXT;
ALTER TABLE file_bundles ADD COLUMN encrypted_data TEXT;
