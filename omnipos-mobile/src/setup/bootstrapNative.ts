import { bootstrapCore } from "@/src/core/bootstrap";
import { createNativeAdapter } from "@/src/core/platform/native";

// Side-effect module: must be the first import in the app entry point so that the
// platform adapter and the UUIDv7 generator are installed before `src/database`
// constructs the WatermelonDB instance.
bootstrapCore(createNativeAdapter());
