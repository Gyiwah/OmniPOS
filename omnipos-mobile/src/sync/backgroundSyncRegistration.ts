/**
 * 15-minute background sync was planned via expo-background-fetch, but that package can break
 * Metro resolution (`./BackgroundFetch.types`) and is deprecated in favor of `expo-background-task`.
 *
 * OmniPOS still syncs via: connectivity events (online), AppState (foreground), and manual Sync on Home.
 * Add `expo-background-task` + EAS dev client when you need true background intervals.
 */
export async function registerBackgroundSync(): Promise<void> {
  return;
}
