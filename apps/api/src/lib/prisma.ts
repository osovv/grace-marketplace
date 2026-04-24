import { PrismaClient } from "@prisma/client";
import { appConfig } from "../config.js";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: appConfig.databaseUrl,
    },
  },
});
