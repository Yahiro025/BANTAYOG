// QR Scanner
// Browser-side QR scanner using html5-qrcode — significantly faster than
// @zxing/browser because it uses the browser's native BarcodeDetector API
// where available and falls back to a WASM decoder.
// Accesses the device camera via getUserMedia — must be client-only.
// FE2 ownership — @bantayog/web

"use client";

export interface ScanResult {
  // Decoded text content of the QR code
  text: string;
  // QR code format (e.g. "QR_CODE")
  format: string;
}

export type ScanCallback = (result: ScanResult) => void;
export type ScanErrorCallback = (error: Error) => void;

// Manages camera-based QR scanning lifecycle using html5-qrcode.
// Unlike the old @zxing/browser implementation, html5-qrcode injects its
// own <video> element into the provided container div, handles getUserMedia
// internally, and scans far more efficiently by leveraging native browser
// APIs where available.
// Usage:
// 1. Render a <div id="qr-reader" /> in your component.
// 2. Call scanner.start("qr-reader", onResult, onError).
// 3. Call scanner.stop() on cleanup.
export class QRScanner {
  private scanner: import("html5-qrcode").Html5Qrcode | null = null;
  private isScanning = false;

  // Start scanning from the given container element ID.
// html5-qrcode injects and manages the video element internally.
  async start(
    containerId: string,
    onResult: ScanCallback,
    onError?: ScanErrorCallback,
  ): Promise<void> {
    if (this.isScanning) return;

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const qr = new Html5Qrcode(containerId, { verbose: false });
      this.scanner = qr;

      await qr.start(
        { facingMode: "environment" },
        {
          fps: 10,
          // Focus on just the center 70% of the viewfinder for faster detection
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          onResult({ text: decodedText, format: "QR_CODE" });
        },
        (_errorMessage) => {
          // Scan errors while no QR code is in frame are expected — ignore them.
          // Only forward catastrophic errors via onError.
        },
      );

      this.isScanning = true;
    } catch (err) {
      this.isScanning = false;
      // If the environment camera fails, fall back to any available camera
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("environment")
      ) {
        try {
          const { Html5Qrcode } = await import("html5-qrcode");
          const qr = new Html5Qrcode(containerId, { verbose: false });
          this.scanner = qr;

          await qr.start(
            { facingMode: "user" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
              onResult({ text: decodedText, format: "QR_CODE" });
            },
            () => {},
          );

          this.isScanning = true;
          return;
        } catch {
          // fall through
        }
      }

      const error =
        err instanceof Error ? err : new Error("Failed to start QR scanner");
      onError?.(error);
      throw error;
    }
  }

  // Stop scanning and release the camera stream.
  async stop(): Promise<void> {
    if (!this.isScanning || !this.scanner) return;
    this.isScanning = false;
    try {
      await this.scanner.stop();
      this.scanner.clear();
    } catch {
      // ignore errors on stop — camera may have already been released
    }
    this.scanner = null;
  }

  // Check if the scanner is currently active
  get scanning(): boolean {
    return this.isScanning;
  }
}
