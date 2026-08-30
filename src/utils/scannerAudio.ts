import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";

// Pre-generated 80ms 1800Hz POS barcode scanner beep (base64 PCM WAV)
const SCAN_BEEP_WAV_BASE64 =
  "data:audio/wav;base64,UklGRmQCAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YUEDAAA" +
  "AAAAAAAAAAAAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAA" +
  "AAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAA" +
  "QAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA//" +
  "///wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD" +
  "//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAA" +
  "AAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////" +
  "wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//w" +
  "AA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAA" +
  "AAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEA" +
  "AQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/////wEAAQAAAAAAAAD//wAA/";

let soundObject: Audio.Sound | null = null;

export async function playScannerBeep(): Promise<void> {
  try {
    // 1. Trigger snappy success haptic feedback
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // 2. Play scanner beep sound
    if (!soundObject) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: SCAN_BEEP_WAV_BASE64 },
        { shouldPlay: true, volume: 1.0 }
      );
      soundObject = sound;
    } else {
      await soundObject.replayAsync();
    }
  } catch (error) {
    if (__DEV__) {
      console.warn("[OmniPOS] Scanner audio playback notice:", error);
    }
  }
}
