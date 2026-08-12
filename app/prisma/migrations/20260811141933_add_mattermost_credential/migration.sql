-- CreateTable
CREATE TABLE "MattermostCredential" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL
);
