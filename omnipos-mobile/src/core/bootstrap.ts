import { setGenerator } from "@nozbe/watermelondb/utils/common/randomId";

import { bindApiBaseUrl } from "@/src/core/api/config";
import { uuidv7 } from "@/src/core/ids/uuidv7";
import { setPlatform } from "@/src/core/platform";
import type { PlatformAdapter } from "@/src/core/platform";

let done = false;

/**
 * Install the host platform and make UUIDv7 the identity scheme for every record
 * WatermelonDB creates.
 *
 * Overriding the generator means a record's local primary key is already a valid
 * server primary key at the moment of creation, offline. That is what allows the
 * sync protocol to be a plain idempotent upsert instead of carrying a parallel
 * `remote_id` column and reconciling local rows against server rows after the fact.
 *
 * Must run before `src/database` is first imported, since that module constructs
 * the Database at load time. Import the platform-specific setup module (e.g.
 * `src/setup/bootstrapNative`) as the very first import of the app entry point.
 */
export function bootstrapCore(adapter: PlatformAdapter): void {
  if (done) return;
  setPlatform(adapter);
  bindApiBaseUrl();
  setGenerator(uuidv7);
  done = true;
}
