import jsQR from 'jsqr';

/**
 * Reads a QR code from a photo (camera or gallery); no camera permission or plugin needed.
 * A QR code photographed on a screen is small in a large photo: the platform detector is tried
 * first, then jsQR at several scales and on centred crops.
 */
export async function readQrFromImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(i: ImageBitmap): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (Detector) {
      try { const [hit] = await new Detector({ formats: ['qr_code'] }).detect(bitmap); if (hit?.rawValue) return hit.rawValue; } catch { /* fall back to jsQR */ }
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const big = Math.max(bitmap.width, bitmap.height);
    // Crop (fraction of the photo, centred) × output size in pixels.
    for (const crop of [1, 0.6, 0.35]) for (const size of [1200, 1800, 800, 2600]) {
      const sw = bitmap.width * crop, sh = bitmap.height * crop;
      const k = Math.min(1, size / (big * crop));
      canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
      ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return code.data;
    }
  } finally { bitmap.close(); }
  throw new Error('Aucun QR code lisible sur la photo : approchez-vous pour qu’il remplisse le cadre, sans reflet.');
}

/**
 * Live scanning with the camera in the app: frames are decoded until a QR code is found.
 * Returns a stop function; `onCode` is called once.
 */
export async function scanLive(video: HTMLVideoElement, onCode: (text: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(i: HTMLVideoElement | HTMLCanvasElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false, timer = 0;
  const stop = () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  const tick = async () => {
    if (stopped) return;
    try {
      let text: string | undefined;
      if (detector) text = (await detector.detect(video).catch(() => []))[0]?.rawValue;
      if (!text && video.videoWidth) {
        // The centre of the frame, where the viewfinder is drawn.
        const side = Math.min(video.videoWidth, video.videoHeight) * 0.8;
        canvas.width = canvas.height = Math.min(800, Math.round(side));
        ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
      }
      if (text && !stopped) { stop(); onCode(text); return; }
    } catch { /* next frame */ }
    timer = window.setTimeout(tick, 150);
  };
  void tick();
  return stop;
}
