import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const client = postgres(url, {
  max: 10,
  ssl: url.includes("railway") || url.includes("sslmode=require") ? "require" : undefined,
});

export const db = drizzle(client, { schema });
export { schema };
