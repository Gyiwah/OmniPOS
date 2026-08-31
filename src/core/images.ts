/**
 * Pure image-reference helpers shared by the sync layer and both clients.
 *
 * Deliberately free of file-system imports: the sync engine needs to classify an
 * image reference (device URI vs. remote object path) on every product push, and
 * must not drag platform I/O into the shared core to do it.
 */

/** True for a reference that points at local device/browser storage rather than the server. */
export function isLocalImageUri(uri: string): boolean {
  return (
    uri.startsWith("file://") ||
    uri.startsWith("content://") ||
    uri.startsWith("ph://") ||
    uri.startsWith("assets-library://") ||
    uri.startsWith("blob:") ||
    uri.startsWith("data:")
  );
}
