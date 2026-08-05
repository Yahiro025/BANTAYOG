// QR Code Generation
// Generates QR codes for Nutri-Pass beneficiary cards.
// The QR payload is a signed JWT from the server's qr-token.service.ts,
// containing claims { bid, bal, ser, ver }.
// FE2 ownership — @bantayog/web

export interface QROptions {
  // Pixel width/height of the generated QR image
  size?: number;
  // Error correction level — higher = more redundant = larger
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

// Generate a QR code as a data-URL string from a signed JWT payload.
// Used by the admin "Issue Nutri-Pass" printable card flow.
export function generateQRDataUrl(
  _data: string,
  _options?: QROptions,
): string {
  // TODO: implement with react-qr-code or qrcode library
  throw new Error("Not implemented — T-1.9 placeholder");
}
