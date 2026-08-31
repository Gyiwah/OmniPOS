import { createWatermelonDb } from "./createDatabase";

/** Single process-local SQLite (native) / LokiIndexedDB (web) database handle */
export const database = createWatermelonDb();

export { default as wmSchema } from "./wmSchema";
