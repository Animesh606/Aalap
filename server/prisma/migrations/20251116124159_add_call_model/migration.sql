-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "participants" TEXT[],
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);
