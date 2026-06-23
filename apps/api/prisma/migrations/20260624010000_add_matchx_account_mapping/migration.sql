CREATE TABLE "MatchxAccount" (
    "userId" TEXT NOT NULL,
    "matchxUserId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchxAccount_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "MatchxIdSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextValue" BIGINT NOT NULL DEFAULT 1000000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchxIdSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchxAccount_matchxUserId_key" ON "MatchxAccount"("matchxUserId");
CREATE INDEX "MatchxAccount_matchxUserId_idx" ON "MatchxAccount"("matchxUserId");

ALTER TABLE "MatchxAccount"
ADD CONSTRAINT "MatchxAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
