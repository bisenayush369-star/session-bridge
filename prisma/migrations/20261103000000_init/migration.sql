-- CreateTable
CREATE TABLE "handoffs" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "memory" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "token_hash" TEXT NOT NULL,
    "payload_bytes" INTEGER NOT NULL,
    "retention" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "last_accessed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handoffs_public_id_key" ON "handoffs"("public_id");

-- CreateIndex
CREATE INDEX "handoffs_expires_at_idx" ON "handoffs"("expires_at");

-- CreateIndex
CREATE INDEX "handoffs_deleted_at_idx" ON "handoffs"("deleted_at");

-- CreateIndex
CREATE INDEX "handoffs_last_accessed_at_idx" ON "handoffs"("last_accessed_at");
