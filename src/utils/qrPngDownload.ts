import { InventoryItem } from '../types/inventory';
import { buildZipArchive, generateQrMatrix } from './inventoryLogic';

/**
 * Sanitizes an item name or QR code into a safe filename segment.
 */
export function sanitizeQrPngFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'QR_Barang'
  );
}

/**
 * Splits a potentially long item name into wrapped lines that fit within `maxWidth` pixels on a 2D canvas.
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['Barang Inventaris'];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const candidate = `${currentLine} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Renders a high-resolution PNG Data URL (`data:image/png;base64,...`)
 * containing ONLY the item's QR code and the item's name underneath.
 */
export function renderQrWithNameToPngDataUrl(
  item: Pick<InventoryItem, 'qrCode' | 'name'>
): string {
  const matrix = generateQrMatrix(item.qrCode, 21);
  const n = matrix.length;
  const quietZone = 4;
  const totalModules = n + quietZone * 2;
  const modulePx = 16; // Crisp integer pixel size per QR module
  const qrBoxSize = totalModules * modulePx; // e.g., 29 * 16 = 464px

  const horizontalPadding = 48;
  const canvasWidth = qrBoxSize + horizontalPadding * 2; // 560px

  // Measure wrapped item name lines first
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const fontSpec =
    'bold 26px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  let nameLines = [item.name.trim() || item.qrCode];
  if (measureCtx) {
    measureCtx.font = fontSpec;
    nameLines = wrapCanvasText(
      measureCtx,
      item.name.trim() || item.qrCode,
      canvasWidth - 64
    );
  }

  const lineHeight = 34;
  const topPadding = 36;
  const gapBetweenQrAndName = 16;
  const bottomPadding = 38;
  const textBlockHeight = nameLines.length * lineHeight;
  const canvasHeight =
    topPadding + qrBoxSize + gapBetweenQrAndName + textBlockHeight + bottomPadding;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Pure white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw crisp QR Code modules
  const qrStartX = Math.round((canvasWidth - qrBoxSize) / 2);
  const qrStartY = topPadding;

  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const x = qrStartX + (c + quietZone) * modulePx;
        const y = qrStartY + (r + quietZone) * modulePx;
        ctx.fillRect(x, y, modulePx, modulePx);
      }
    }
  }

  // Draw ONLY the Item Name centered underneath the QR code
  ctx.font = fontSpec;
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const textStartY = qrStartY + qrBoxSize + gapBetweenQrAndName;
  nameLines.forEach((line, idx) => {
    ctx.fillText(line, canvasWidth / 2, textStartY + idx * lineHeight);
  });

  return canvas.toDataURL('image/png');
}

/**
 * Converts a `data:image/png;base64,...` string into a `Uint8Array` of raw PNG bytes.
 */
export function dataUrlToPngBytes(dataUrl: string): Uint8Array {
  const base64Idx = dataUrl.indexOf(';base64,');
  if (base64Idx === -1) return new Uint8Array(0);
  const b64 = dataUrl.slice(base64Idx + 8);
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Downloads a single item's QR + Name as a `.png` file.
 */
export function downloadSingleItemQrPng(
  item: Pick<InventoryItem, 'qrCode' | 'name'>
): void {
  const dataUrl = renderQrWithNameToPngDataUrl(item);
  if (!dataUrl) return;

  const safeName = sanitizeQrPngFilename(item.name);
  const safeQr = sanitizeQrPngFilename(item.qrCode);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `QR_${safeName}_${safeQr}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Bulk-downloads all given items as `.png` files (each containing ONLY QR and item name)
 * packaged inside a single `.zip` archive so the browser downloads all of them in 1 click.
 * If only 1 item is passed, downloads the `.png` file directly.
 */
export function downloadBulkItemsQrPng(
  items: Array<Pick<InventoryItem, 'qrCode' | 'name'>>,
  zipFilenamePrefix = 'Bulk-QR-Barang-ODipinjam'
): number {
  if (!items || items.length === 0) return 0;

  if (items.length === 1) {
    downloadSingleItemQrPng(items[0]);
    return 1;
  }

  const usedNames = new Set<string>();
  const zipEntries: Array<{ name: string; data: Uint8Array }> = [];

  items.forEach((item, idx) => {
    const dataUrl = renderQrWithNameToPngDataUrl(item);
    const pngBytes = dataUrlToPngBytes(dataUrl);
    if (pngBytes.length === 0) return;

    const numPrefix = String(idx + 1).padStart(3, '0');
    const safeName = sanitizeQrPngFilename(item.name);
    const safeQr = sanitizeQrPngFilename(item.qrCode);
    let entryName = `${numPrefix}_${safeName}_${safeQr}.png`;
    if (usedNames.has(entryName.toLowerCase())) {
      entryName = `${numPrefix}_${safeName}_${safeQr}_${idx + 1}.png`;
    }
    usedNames.add(entryName.toLowerCase());

    zipEntries.push({
      name: entryName,
      data: pngBytes,
    });
  });

  if (zipEntries.length === 0) return 0;

  const zipBytes = buildZipArchive(zipEntries);
  const blob = new Blob([zipBytes as unknown as BlobPart], {
    type: 'application/zip',
  });
  const url = URL.createObjectURL(blob);
  const datePart = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${zipFilenamePrefix}-${datePart}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return zipEntries.length;
}
