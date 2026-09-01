import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera } from "lucide-react";

/**
 * Scanning a barcode with the device camera.
 *
 * Built on the browser's own BarcodeDetector rather than a bundled decoder. A
 * decoder is a few hundred kilobytes of WebAssembly that every till would
 * download and precache, including the great majority that scan with a handheld
 * reader — and a handheld reader needs none of this, because it types the digits
 * like a keyboard straight into the search box.
 *
 * So this is an enhancement for a tablet with no reader attached, and it says so
 * plainly where the API is missing rather than pretending to be broken.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function barcodeScanningSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];

type Props = {
  onScan: (value: string) => void;
  onClose: () => void;
};

export function BarcodeScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    async function start() {
      const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

      if (!Ctor) {
        setError("This browser has no barcode reader built in. Type the code, or use a handheld scanner.");
        return;
      }

      try {
        // The rear camera is the one pointed at the shelf.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch (cause) {
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Camera access was refused. Allow it in the browser's site settings, or type the code."
            : "No camera is available on this device.",
        );
        return;
      }

      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setReady(true);

      const detector = new Ctor({ formats: FORMATS });

      const tick = async () => {
        if (stopped || !videoRef.current) return;

        try {
          const found = await detector.detect(videoRef.current);
          const value = found[0]?.rawValue?.trim();
          if (value) {
            // Stop before handing the value up: the caller closes this, and a
            // detection landing after that would fire a second scan.
            stopped = true;
            onScan(value);
            return;
          }
        } catch {
          // A frame that could not be decoded is the normal case, not an error.
        }

        frame = requestAnimationFrame(() => void tick());
      };

      frame = requestAnimationFrame(() => void tick());
    }

    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      // Releasing every track is what turns the camera light off. Leaving it on
      // after the panel closes looks, correctly, like the shop is being watched.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Scan a barcode">
      <div className="modal scanner">
        <h2>
          <Camera size={18} aria-hidden="true" /> Scan a barcode
        </h2>

        {error ? (
          <p className="notice notice-warn">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : (
          <div className="scanner-frame">
            <video ref={videoRef} playsInline muted className="scanner-video" />
            <div className="scanner-reticle" aria-hidden="true" />
          </div>
        )}

        {!error && !ready && <p className="muted">Starting the camera…</p>}
        {ready && <p className="muted">Hold the barcode inside the frame.</p>}

        <div className="modal-actions">
          <span />
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
