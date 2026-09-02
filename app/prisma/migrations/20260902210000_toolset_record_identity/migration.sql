-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ToolsetRecord" (
    "id" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "namespace" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("namespace", "collection", "id")
);
INSERT INTO "new_ToolsetRecord" ("collection", "createdAt", "id", "namespace", "payload", "updatedAt") SELECT "collection", "createdAt", "key", "namespace", "payload", "updatedAt" FROM "ToolsetRecord";
DROP TABLE "ToolsetRecord";
ALTER TABLE "new_ToolsetRecord" RENAME TO "ToolsetRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
