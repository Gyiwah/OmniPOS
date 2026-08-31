import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let result = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;

    result += B64_CHARS[(triplet >> 18) & 63];
    result += B64_CHARS[(triplet >> 12) & 63];
    result += i + 1 < len ? B64_CHARS[(triplet >> 6) & 63] : "=";
    result += i + 2 < len ? B64_CHARS[triplet & 63] : "=";
  }
  return result;
}

function generateWavBase64(): string {
  const sampleRate = 22050;
  const duration = 0.08; // 80ms
  const frequency = 2300; // Authentic POS scanner beep pitch (2.3 kHz)
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // "fmt " sub-chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // "data" sub-chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Generate PCM Sine Wave with Attack/Decay envelope to prevent audio clicking
  const attackSamples = Math.floor(numSamples * 0.1);
  const decaySamples = Math.floor(numSamples * 0.2);

  for (let i = 0; i < numSamples; i++) {
    let envelope = 1.0;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else if (i > numSamples - decaySamples) {
      envelope = (numSamples - i) / decaySamples;
    }

    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.85 * envelope;
    const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  return uint8ArrayToBase64(new Uint8Array(buffer));
}

let soundObject: Audio.Sound | null = null;
let soundInitPromise: Promise<Audio.Sound | null> | null = null;

async function ensureAudioBeepLoaded(): Promise<Audio.Sound | null> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    const cacheDir = FileSystem.cacheDirectory ?? "";
    const filePath = `${cacheDir}omnipos_scan_beep.wav`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);

    if (!fileInfo.exists) {
      const b64 = generateWavBase64();
      await FileSystem.writeAsStringAsync(filePath, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: filePath },
      { shouldPlay: false, volume: 1.0 }
    );
    soundObject = sound;
    return sound;
  } catch {
    return null;
  }
}

export async function playScannerBeep(): Promise<void> {
  try {
    // 1. Instant haptic feedback
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // 2. Initialize sound if not ready
    if (!soundObject) {
      if (!soundInitPromise) {
        soundInitPromise = ensureAudioBeepLoaded();
      }
      soundObject = await soundInitPromise;
    }

    // 3. Play sound from start
    if (soundObject) {
      await soundObject.setPositionAsync(0);
      await soundObject.playAsync();
    }
  } catch {
    // Clear cache to re-init on next scan if needed
    soundObject = null;
    soundInitPromise = null;
  }
}
