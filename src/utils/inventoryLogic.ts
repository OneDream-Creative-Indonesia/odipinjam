import {
  BulkInventoryRowInput,
  DueState,
  EmailNotification,
  InventoryItem,
  LoanRecord,
  MonthlyLoanSummary,
  User,
  UserRole,
} from '../types/inventory';

/**
 * Formats a Date object as local YYYY-MM-DD for HTML date inputs without UTC day shifting.
 */
export function formatDateInputLocal(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a YYYY-MM-DD date input string into an ISO string at 23:59:59 local time
 * so the selected date remains consistent in Indonesian local timezones (WIB/WITA/WIT).
 * Returns an empty string if the input date is invalid.
 */
export function parseLocalEndOfDayIso(dateStr: string): string {
  const trimmed = (dateStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return '';
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const dt = new Date(year, month - 1, day, 23, 59, 59, 0);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString();
}

/**
 * Generates a standardized, human-readable + scannable QR Code identifier
 * Example: INV-ELK-0014
 */
export function generateQrCodeString(
  name: string,
  category: string,
  sequence: number
): string {
  const cleanCat = (category || 'BRG')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
  const cleanName = (name || 'ITEM')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, '0');
  const seqStr = String(Math.max(1, sequence)).padStart(4, '0');
  return `INV-${cleanCat}-${cleanName}-${seqStr}`;
}

/**
 * Generates a standard-compliant ISO/IEC 18004 QR-Code matrix (Byte mode, EC Level L)
 * with Reed-Solomon error correction so real camera scanners (iOS/Android/jsQR/BarcodeDetector)
 * can scan and decode the QR code directly.
 */
export function generateQrMatrix(text: string, _size = 21): boolean[][] {
  const payload = (text || '').trim() || 'INV-DEFAULT';
  const utf8Bytes = Array.from(new TextEncoder().encode(payload));

  // ISO/IEC 18004 Version 1..4 capacities for EC Level L (single RS block)
  const versions = [
    { version: 1, size: 21, dataBytes: 19, ecBytes: 7, align: [] as number[] },
    { version: 2, size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
    { version: 3, size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
    { version: 4, size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
  ];

  // Pick smallest version that fits: 4 bits mode + 8 bits length + 8*N bits
  const chosen =
    versions.find((v) => utf8Bytes.length + 2 <= v.dataBytes) || versions[3];
  const maxPayload = chosen.dataBytes - 2;
  const data = utf8Bytes.slice(0, maxPayload);
  const n = chosen.size;

  // Build bit stream: Mode 0100 (Byte), 8-bit char count, byte data, terminator, pad bytes
  const bitStream: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(data.length, 8);
  for (const b of data) {
    pushBits(b, 8);
  }

  const maxDataBits = chosen.dataBytes * 8;
  const terminatorLen = Math.min(4, maxDataBits - bitStream.length);
  pushBits(0, terminatorLen);
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }

  const dataCodewords: number[] = [];
  for (let i = 0; i < bitStream.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bitStream[i + b];
    }
    dataCodewords.push(byte);
  }

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataCodewords.length < chosen.dataBytes) {
    dataCodewords.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // Reed-Solomon GF(256) with primitive polynomial 0x11d
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    gfExp[i] = gfExp[i - 255];
  }
  const gfMul = (a: number, b: number) =>
    a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]];

  let gen = [1];
  for (let i = 0; i < chosen.ecBytes; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const root = gfExp[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }

  const ecCodewords = new Array(chosen.ecBytes).fill(0);
  for (const byte of dataCodewords) {
    const factor = byte ^ ecCodewords[0];
    ecCodewords.shift();
    ecCodewords.push(0);
    for (let j = 0; j < chosen.ecBytes; j++) {
      ecCodewords[j] ^= gfMul(gen[j + 1], factor);
    }
  }

  const allCodewords = [...dataCodewords, ...ecCodewords];
  const allBits: number[] = [];
  for (const cw of allCodewords) {
    for (let b = 7; b >= 0; b--) {
      allBits.push((cw >> b) & 1);
    }
  }

  const matrix: boolean[][] = Array.from({ length: n }, () =>
    Array(n).fill(false)
  );
  const reserved: boolean[][] = Array.from({ length: n }, () =>
    Array(n).fill(false)
  );

  const placeFinder = (rowOffset: number, colOffset: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          matrix[rr][cc] = isBorder || isCenter;
        } else {
          matrix[rr][cc] = false;
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Alignment patterns for Version >= 2
  if (chosen.align.length > 0) {
    for (const ar of chosen.align) {
      for (const ac of chosen.align) {
        if (reserved[ar][ac]) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const rr = ar + r;
            const cc = ac + c;
            reserved[rr][cc] = true;
            const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
            const isCenter = r === 0 && c === 0;
            matrix[rr][cc] = isBorder || isCenter;
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    if (!reserved[6][i]) {
      reserved[6][i] = true;
      matrix[6][i] = i % 2 === 0;
    }
    if (!reserved[i][6]) {
      reserved[i][6] = true;
      matrix[i][6] = i % 2 === 0;
    }
  }

  // Dark module and Format Information areas
  reserved[n - 8][8] = true;
  matrix[n - 8][8] = true;

  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }

  // Place data bits in upward/downward 2-column zigzag with Mask Pattern 0: (r + c) % 2 === 0
  let bitIdx = 0;
  let upward = true;
  for (let rightCol = n - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing column 6
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (let dCol = 0; dCol < 2; dCol++) {
        const c = rightCol - dCol;
        if (!reserved[r][c]) {
          const dataBit = bitIdx < allBits.length ? allBits[bitIdx] === 1 : false;
          bitIdx++;
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = dataBit !== mask;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for EC Level L (01) + Mask 0 (000) => 0x77c4
  const formatBits = 0x77c4;
  const fBit = (i: number) => ((formatBits >> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) matrix[i][8] = fBit(i);
  matrix[7][8] = fBit(6);
  matrix[8][8] = fBit(7);
  matrix[8][7] = fBit(8);
  for (let i = 9; i <= 14; i++) matrix[8][14 - i] = fBit(i);

  for (let i = 0; i <= 7; i++) matrix[8][n - 1 - i] = fBit(i);
  for (let i = 8; i <= 14; i++) matrix[n - 15 + i][8] = fBit(i);

  return matrix;
}

/**
 * Evaluates loan status and due date to determine whether a loan is safe,
 * approaching its deadline (within warningHoursThreshold, default 24h),
 * overdue, or already returned.
 */
export function calculateDueState(
  loan: Pick<LoanRecord, 'status' | 'dueDate'>,
  referenceTimeIso: string,
  warningHoursThreshold = 24
): { state: DueState; hoursRemaining: number; label: string } {
  if (loan.status === 'dikembalikan') {
    return {
      state: 'selesai',
      hoursRemaining: 0,
      label: 'Sudah Dikembalikan',
    };
  }

  const refMs = new Date(referenceTimeIso).getTime();
  const dueMs = new Date(loan.dueDate).getTime();
  const diffHours = Math.round(((dueMs - refMs) / (1000 * 60 * 60)) * 10) / 10;

  if (diffHours < 0) {
    const overdueHours = Math.abs(Math.round(diffHours));
    const days = Math.floor(overdueHours / 24);
    const label =
      days >= 1
        ? `Terlambat ${days} hari`
        : `Terlambat ${Math.max(1, overdueHours)} jam`;
    return {
      state: 'terlambat',
      hoursRemaining: diffHours,
      label,
    };
  }

  if (diffHours <= warningHoursThreshold) {
    return {
      state: 'hampir_habis',
      hoursRemaining: diffHours,
      label: `Sisa ${Math.max(1, Math.ceil(diffHours))} jam`,
    };
  }

  const daysLeft = Math.ceil(diffHours / 24);
  return {
    state: 'aman',
    hoursRemaining: diffHours,
    label: `Sisa ${daysLeft} hari`,
  };
}

/**
 * Validates structured column rows (from the website's column grid or parsed Excel/CSV file)
 * into ready-to-import InventoryItem objects.
 */
export function validateBulkInventoryRows(
  rows: BulkInventoryRowInput[],
  existingCount: number,
  existingQrCodes: string[] = []
): {
  items: Omit<InventoryItem, 'id' | 'createdAt'>[];
  errors: string[];
} {
  const items: Omit<InventoryItem, 'id' | 'createdAt'>[] = [];
  const errors: string[] = [];
  const usedQrs = new Set<string>(
    existingQrCodes.map((q) => q.trim().toLowerCase())
  );

  // Filter out completely blank rows so empty trailing rows in a table don't trigger errors
  const nonEmptyRows = rows
    .map((r, idx) => ({ row: r, rowNum: idx + 1 }))
    .filter(({ row }) => {
      const hasAny =
        String(row.name || '').trim() !== '' ||
        String(row.customQr || '').trim() !== '' ||
        String(row.description || '').trim() !== '' ||
        String(row.imageUrl || '').trim() !== '';
      return hasAny;
    });

  if (nonEmptyRows.length === 0) {
    return { items: [], errors: [] };
  }

  for (const { row, rowNum } of nonEmptyRows) {
    const name = String(row.name || '').trim();
    const category = String(row.category || 'Umum').trim() || 'Umum';
    const stockRaw = String(row.totalStock ?? '1').trim() || '1';
    const location =
      String(row.location || 'Gudang Utama').trim() || 'Gudang Utama';
    const conditionRaw = String(row.condition || 'Baik').trim();
    const customQr = String(row.customQr || '').trim().toUpperCase();
    const description =
      String(row.description || '').trim() ||
      `Barang inventaris kategori ${category}`;
    const imageUrl = String(row.imageUrl || '').trim();

    if (!name) {
      errors.push(`Baris ${rowNum}: Nama barang wajib diisi.`);
      continue;
    }

    const parsedStock = Number.parseInt(stockRaw, 10);
    if (Number.isNaN(parsedStock) || parsedStock <= 0) {
      errors.push(
        `Baris ${rowNum} ("${name}"): Jumlah stok harus berupa angka positif.`
      );
      continue;
    }

    const condition: 'Baik' | 'Perlu Perawatan' =
      conditionRaw.toLowerCase().includes('rawat') ||
      conditionRaw.toLowerCase().includes('perlu')
        ? 'Perlu Perawatan'
        : 'Baik';

    let qrCode = customQr;
    if (qrCode) {
      if (usedQrs.has(qrCode.toLowerCase())) {
        errors.push(
          `Baris ${rowNum} ("${name}"): Kode QR "${qrCode}" sudah digunakan oleh barang lain.`
        );
        continue;
      }
    } else {
      let seq = existingCount + items.length + 1;
      qrCode = generateQrCodeString(name, category, seq);
      while (usedQrs.has(qrCode.toLowerCase())) {
        seq++;
        qrCode = generateQrCodeString(name, category, seq);
      }
    }
    usedQrs.add(qrCode.toLowerCase());

    items.push({
      qrCode,
      name,
      category,
      totalStock: parsedStock,
      availableStock: parsedStock,
      location,
      condition,
      description,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }

  return { items, errors };
}

/**
 * Parses spreadsheet text (TSV, semicolon-delimited Excel CSV, HTML/XML .xls table, or standard CSV)
 * into structured column rows (`BulkInventoryRowInput[]`).
 */
export function parseSpreadsheetTextToRows(
  rawText: string
): BulkInventoryRowInput[] {
  const cleaned = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  // Handle HTML table / XML .xls if someone saved as Web Page .xls
  if (/<table[\s>]/i.test(cleaned) && /<tr[\s>]/i.test(cleaned)) {
    const trMatches = cleaned.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const tableRows: string[][] = [];
    for (const tr of trMatches) {
      const cellMatches = tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
      if (cellMatches.length === 0) continue;
      const cols = cellMatches.map((cell) => {
        const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(cell);
        const text = cell
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim();
        return text || (imgMatch ? imgMatch[1].trim() : '');
      });
      tableRows.push(cols);
    }
    if (tableRows.length > 0) {
      const firstCols = tableRows[0].map((c) => c.toLowerCase());
      const hasHeader =
        firstCols.some((c) => c.includes('nama') || c.includes('name')) ||
        firstCols.some(
          (c) =>
            c.includes('kategori') ||
            c.includes('category') ||
            c.includes('stok')
        );
      const start = hasHeader ? 1 : 0;
      return tableRows.slice(start).map((cols) => ({
        name: (cols[0] || '').trim(),
        category: (cols[1] || 'Umum').trim() || 'Umum',
        totalStock: (cols[2] || '1').trim() || '1',
        location: (cols[3] || 'Gudang Utama').trim() || 'Gudang Utama',
        condition: (cols[4] || 'Baik').trim() || 'Baik',
        customQr: (cols[5] || '').trim(),
        description: (cols[6] || '').trim(),
        imageUrl: (cols[7] || '').trim(),
      }));
    }
  }

  let lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  let forcedDelimiter: string | null = null;
  if (/^sep=(.)$/i.test(lines[0])) {
    forcedDelimiter = lines[0].slice(4);
    lines = lines.slice(1);
  }

  if (lines.length === 0) return [];

  const detectDelimiter = (sample: string): string => {
    if (forcedDelimiter) return forcedDelimiter;
    if (sample.includes('\t')) return '\t';
    const semiCount = (sample.match(/;/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    return semiCount >= commaCount && semiCount > 0 ? ';' : ',';
  };

  const delimiter = detectDelimiter(lines[0]);

  const splitRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const firstRowCols = splitRow(lines[0]).map((c) => c.toLowerCase());
  const hasHeader =
    firstRowCols.some((c) => c.includes('nama') || c.includes('name')) ||
    firstRowCols.some(
      (c) =>
        c.includes('kategori') || c.includes('category') || c.includes('stok')
    );

  const startIdx = hasHeader ? 1 : 0;
  const rows: BulkInventoryRowInput[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    rows.push({
      name: (cols[0] || '').trim(),
      category: (cols[1] || 'Umum').trim() || 'Umum',
      totalStock: (cols[2] || '1').trim() || '1',
      location: (cols[3] || 'Gudang Utama').trim() || 'Gudang Utama',
      condition: (cols[4] || 'Baik').trim() || 'Baik',
      customQr: (cols[5] || '').trim(),
      description: (cols[6] || '').trim(),
      imageUrl: (cols[7] || '').trim(),
    });
  }

  return rows;
}

/**
 * Parses CSV, semicolon-delimited Excel CSV, or TSV spreadsheet rows into inventory items.
 * Expected columns (header optional):
 * Nama Barang, Kategori, Total Stok, Lokasi, Kondisi, Kode QR (opsional), Deskripsi (opsional), Gambar Barang (opsional)
 */
export function parseBulkInventoryCsv(
  rawText: string,
  existingCount: number,
  existingQrCodes: string[] = []
): {
  items: Omit<InventoryItem, 'id' | 'createdAt'>[];
  errors: string[];
} {
  if (!rawText || !rawText.trim()) {
    return { items: [], errors: ['File atau teks CSV kosong.'] };
  }

  const rows = parseSpreadsheetTextToRows(rawText);
  if (rows.length === 0) {
    return { items: [], errors: ['File atau teks CSV kosong.'] };
  }

  return validateBulkInventoryRows(rows, existingCount, existingQrCodes);
}

// ============================================================================
// NATIVE EXCEL (.XLSX) GENERATOR & PARSER (SEPARATE COLUMNS + PHYSICAL IMAGE)
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&amp;/g, '&');
}

function colIndexToLetter(colIdx: number): string {
  let n = colIdx + 1;
  let str = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

function colLetterToIndex(letters: string): number {
  let idx = 0;
  const clean = letters.toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    idx = idx * 26 + (clean.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

/**
 * Builds a genuine OpenXML Excel Workbook (.xlsx) binary with dedicated columns
 * (Kolom A to Kolom H) so Excel opens each field in its own separate column without commas.
 */
export function buildInventoryExcelTemplateXlsx(
  sampleRows: BulkInventoryRowInput[]
): Uint8Array {
  const headers = [
    'Nama Barang',
    'Kategori',
    'Total Stok',
    'Lokasi',
    'Kondisi',
    'Kode QR',
    'Deskripsi',
    'Gambar Barang',
  ];

  const headerCellsXml = headers
    .map((h, cIdx) => {
      const ref = `${colIndexToLetter(cIdx)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escapeXml(h)}</t></is></c>`;
    })
    .join('');

  const dataRowsXml = sampleRows
    .map((row, rIdx) => {
      const rowNum = rIdx + 2;
      const values = [
        String(row.name ?? ''),
        String(row.category ?? 'Umum'),
        String(row.totalStock ?? '1'),
        String(row.location ?? 'Gudang Utama'),
        String(row.condition ?? 'Baik'),
        String(row.customQr ?? ''),
        String(row.description ?? ''),
        String(row.imageUrl ?? ''),
      ];
      const cells = values
        .map((val, cIdx) => {
          const ref = `${colIndexToLetter(cIdx)}${rowNum}`;
          if (cIdx === 2 && /^\d+$/.test(val.trim())) {
            return `<c r="${ref}" s="2"><v>${val.trim()}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr" s="2"><is><t>${escapeXml(val)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}" ht="22" customHeight="1">${cells}</row>`;
    })
    .join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="34" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="14" customWidth="1"/>
    <col min="4" max="4" width="22" customWidth="1"/>
    <col min="5" max="5" width="18" customWidth="1"/>
    <col min="6" max="6" width="20" customWidth="1"/>
    <col min="7" max="7" width="46" customWidth="1"/>
    <col min="8" max="8" width="48" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="26" customHeight="1">${headerCellsXml}</row>
    ${dataRowsXml}
  </sheetData>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Template Import Inventaris" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const encoder = new TextEncoder();
  const entries = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) },
  ];

  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // Store (0)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, entry.data);

    // Central directory header (46 bytes + name)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);

    cdChunks.push(cdHeader);
    offset += localHeader.length + size;
  }

  const cdSize = cdChunks.reduce((acc, c) => acc + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of cdChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(eocd, pos);
  return out;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressed as unknown as BufferSource).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const res = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      res.set(c, offset);
      offset += c.length;
    }
    return res;
  }
  return compressed;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * Parses an uploaded Excel (.xlsx) file buffer into `BulkInventoryRowInput[]`,
 * extracting all 8 columns AND any embedded worksheet images (`xl/media/*`).
 */
export async function parseInventoryExcelXlsx(
  input: ArrayBuffer | Uint8Array
): Promise<BulkInventoryRowInput[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate End of Central Directory (0x06054b50)
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('Format file .xlsx tidak valid.');
  }

  const totalEntries = view.getUint16(eocdPos + 10, true);
  let cdPos = view.getUint32(eocdPos + 16, true);
  const decoder = new TextDecoder('utf-8');
  const files = new Map<string, Uint8Array>();

  for (let e = 0; e < totalEntries; e++) {
    if (cdPos + 46 > bytes.length || view.getUint32(cdPos, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(cdPos + 10, true);
    const compSize = view.getUint32(cdPos + 20, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);

    const fileName = decoder.decode(
      bytes.subarray(cdPos + 46, cdPos + 46 + nameLen)
    );
    cdPos += 46 + nameLen + extraLen + commentLen;

    if (
      localOffset + 30 <= bytes.length &&
      view.getUint32(localOffset, true) === 0x04034b50
    ) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const rawSlice = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        files.set(fileName, rawSlice);
      } else if (method === 8) {
        const inflated = await inflateRawBytes(rawSlice);
        files.set(fileName, inflated);
      }
    }
  }

  // 1. Parse sharedStrings.xml if present
  const sharedStrings: string[] = [];
  const ssBytes = files.get('xl/sharedStrings.xml');
  if (ssBytes) {
    const ssXml = decoder.decode(ssBytes);
    const siMatches = ssXml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches
        .map((t) => unescapeXml(t.replace(/<\/?t(?:\s[^>]*)?>/g, '')))
        .join('');
      sharedStrings.push(text);
    }
  }

  // 2. Extract embedded images from xl/media/* if user inserted pictures in Excel
  const mediaDataUrls = new Map<string, string>();
  const orderedMediaDataUrls: string[] = [];
  for (const [path, fileBytes] of files.entries()) {
    if (path.startsWith('xl/media/')) {
      const lower = path.toLowerCase();
      let mime = 'image/png';
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
      else if (lower.endsWith('.webp')) mime = 'image/webp';
      else if (lower.endsWith('.gif')) mime = 'image/gif';
      else if (lower.endsWith('.svg')) mime = 'image/svg+xml';
      const dataUrl = `data:${mime};base64,${uint8ToBase64(fileBytes)}`;
      const baseName = path.split('/').pop() || path;
      mediaDataUrls.set(baseName, dataUrl);
      orderedMediaDataUrls.push(dataUrl);
    }
  }

  // Map 0-based Excel row index -> embedded image dataUrl via drawing1.xml
  const rowEmbeddedImages = new Map<number, string>();
  const drawingRelsBytes = files.get('xl/drawings/_rels/drawing1.xml.rels');
  const drawingBytes = files.get('xl/drawings/drawing1.xml');
  if (drawingBytes && mediaDataUrls.size > 0) {
    const rIdToMedia = new Map<string, string>();
    if (drawingRelsBytes) {
      const relsXml = decoder.decode(drawingRelsBytes);
      const relMatches = relsXml.match(/<Relationship\s+[^>]*\/?>/g) || [];
      for (const rel of relMatches) {
        const idMatch = /Id=["']([^"']+)["']/.exec(rel);
        const targetMatch = /Target=["']([^"']+)["']/.exec(rel);
        if (idMatch && targetMatch) {
          const baseName = targetMatch[1].split('/').pop() || '';
          const dUrl = mediaDataUrls.get(baseName);
          if (dUrl) rIdToMedia.set(idMatch[1], dUrl);
        }
      }
    }

    const drawingXml = decoder.decode(drawingBytes);
    const anchorMatches =
      drawingXml.match(
        /<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/g
      ) || [];
    for (const anchor of anchorMatches) {
      const fromMatch = /<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>[\s\S]*?<\/(?:xdr:)?from>/.exec(
        anchor
      );
      const blipMatch = /r:embed=["']([^"']+)["']/.exec(anchor);
      if (fromMatch && blipMatch) {
        const rowIdx0 = Number.parseInt(fromMatch[1], 10);
        const dUrl = rIdToMedia.get(blipMatch[1]);
        if (dUrl && !Number.isNaN(rowIdx0)) {
          rowEmbeddedImages.set(rowIdx0, dUrl);
        }
      }
    }
  }

  // 3. Parse first worksheet
  const sheetBytes =
    files.get('xl/worksheets/sheet1.xml') ||
    Array.from(files.entries()).find(([k]) =>
      k.startsWith('xl/worksheets/sheet')
    )?.[1];

  if (!sheetBytes) {
    throw new Error('Lembar kerja (worksheet) tidak ditemukan di dalam file Excel.');
  }

  const sheetXml = decoder.decode(sheetBytes);
  const rowMatches = sheetXml.match(/<row[\s>][\s\S]*?<\/row>/g) || [];
  const parsedGrid: { rowNumber1Based: number; cols: string[] }[] = [];

  for (let rIdx = 0; rIdx < rowMatches.length; rIdx++) {
    const rowXml = rowMatches[rIdx];
    const rAttrMatch = /<row[^>]*\sr=["'](\d+)["']/.exec(rowXml);
    const rowNumber1Based = rAttrMatch
      ? Number.parseInt(rAttrMatch[1], 10)
      : rIdx + 1;

    const cols: string[] = [];
    const cellMatches =
      rowXml.match(/<c(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/c>)/g) || [];

    for (let cIdx = 0; cIdx < cellMatches.length; cIdx++) {
      const cellXml = cellMatches[cIdx];
      const refMatch = /\sr=["']([A-Za-z]+)\d+["']/.exec(cellXml);
      const colPos = refMatch ? colLetterToIndex(refMatch[1]) : cIdx;
      const typeMatch = /\st=["']([^"']+)["']/.exec(cellXml);
      const cellType = typeMatch ? typeMatch[1] : '';

      let val = '';
      if (cellType === 'inlineStr') {
        const tMatches = cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
        val = tMatches
          .map((t) => unescapeXml(t.replace(/<\/?t(?:\s[^>]*)?>/g, '')))
          .join('');
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
        if (vMatch) {
          const rawV = unescapeXml(vMatch[1].trim());
          if (cellType === 's') {
            const sIdx = Number.parseInt(rawV, 10);
            val = sharedStrings[sIdx] ?? rawV;
          } else {
            val = rawV;
          }
        }
      }
      cols[colPos] = val.trim();
    }

    parsedGrid.push({ rowNumber1Based, cols });
  }

  if (parsedGrid.length === 0) return [];

  const firstRowCols = parsedGrid[0].cols.map((c) => (c || '').toLowerCase());
  const hasHeader =
    firstRowCols.some((c) => c.includes('nama') || c.includes('name')) ||
    firstRowCols.some(
      (c) =>
        c.includes('kategori') || c.includes('category') || c.includes('stok')
    );

  const startIdx = hasHeader ? 1 : 0;
  const result: BulkInventoryRowInput[] = [];
  let fallbackMediaIdx = 0;

  for (let i = startIdx; i < parsedGrid.length; i++) {
    const { rowNumber1Based, cols } = parsedGrid[i];
    const excelRow0Based = rowNumber1Based - 1;
    const embeddedImg = rowEmbeddedImages.get(excelRow0Based);
    let imageUrl = (cols[7] || '').trim() || embeddedImg || '';

    // If user embedded images without drawing anchors (e.g. Place in Cell) and cell is #VALUE! or empty
    if (
      (!imageUrl || imageUrl === '#VALUE!' || imageUrl.startsWith('_xlfn')) &&
      rowEmbeddedImages.size === 0 &&
      fallbackMediaIdx < orderedMediaDataUrls.length
    ) {
      imageUrl = orderedMediaDataUrls[fallbackMediaIdx++];
    }

    const rowObj: BulkInventoryRowInput = {
      name: (cols[0] || '').trim(),
      category: (cols[1] || 'Umum').trim() || 'Umum',
      totalStock: (cols[2] || '1').trim() || '1',
      location: (cols[3] || 'Gudang Utama').trim() || 'Gudang Utama',
      condition: (cols[4] || 'Baik').trim() || 'Baik',
      customQr: (cols[5] || '').trim(),
      description: (cols[6] || '').trim(),
      imageUrl,
    };

    if (
      rowObj.name ||
      rowObj.customQr ||
      rowObj.description ||
      rowObj.imageUrl
    ) {
      result.push(rowObj);
    }
  }

  return result;
}

/**
 * Generates automated email notifications for:
 * 1) Loans whose due date is approaching (<= 24 hours remaining)
 * 2) Loans that are overdue and have not been returned yet
 */
export function buildAutomatedEmailNotifications(
  loans: LoanRecord[],
  existingNotifications: EmailNotification[],
  referenceTimeIso: string
): {
  newNotifications: EmailNotification[];
  updatedLoans: LoanRecord[];
} {
  const newNotifications: EmailNotification[] = [];
  const updatedLoans = loans.map((loan) => ({ ...loan }));

  for (let i = 0; i < updatedLoans.length; i++) {
    const loan = updatedLoans[i];
    if (loan.status !== 'dipinjam') continue;

    const dueInfo = calculateDueState(loan, referenceTimeIso, 24);

    if (dueInfo.state === 'hampir_habis' && !loan.reminderSentAt) {
      const alreadySent = existingNotifications.some(
        (n) =>
          n.loanId === loan.id && n.type === 'batas_waktu_hampir_habis'
      );
      if (!alreadySent) {
        const dueFormatted = new Date(loan.dueDate).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const notif: EmailNotification = {
          id: `email-rem-${loan.id}-${Date.now()}-${i}`,
          recipientEmail: loan.userEmail,
          recipientName: loan.userName,
          userId: loan.userId,
          loanId: loan.id,
          itemName: loan.itemName,
          itemQrCode: loan.itemQrCode,
          type: 'batas_waktu_hampir_habis',
          subject: `[Pengingat SiPinjam] Batas Waktu Peminjaman "${loan.itemName}" Hampir Habis`,
          body: `Halo ${loan.userName},\n\nKami mengingatkan bahwa masa peminjaman barang "${loan.itemName}" (Kode QR: ${loan.itemQrCode}, Jumlah: ${loan.quantity} unit) akan segera berakhir pada ${dueFormatted} (${dueInfo.label}).\n\nKeperluan Peminjaman: ${loan.purposeNotes}\n\nMohon segera menyiapkan pengembalian barang melalui menu Pengembalian Barang dan melampirkan bukti foto kondisi barang.`,
          sentAt: referenceTimeIso,
          read: false,
        };
        newNotifications.push(notif);
      }
      loan.reminderSentAt = referenceTimeIso;
    } else if (dueInfo.state === 'terlambat' && !loan.overdueEmailSentAt) {
      const alreadySent = existingNotifications.some(
        (n) => n.loanId === loan.id && n.type === 'belum_dikembalikan'
      );
      if (!alreadySent) {
        const dueFormatted = new Date(loan.dueDate).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        const notif: EmailNotification = {
          id: `email-ovd-${loan.id}-${Date.now()}-${i}`,
          recipientEmail: loan.userEmail,
          recipientName: loan.userName,
          userId: loan.userId,
          loanId: loan.id,
          itemName: loan.itemName,
          itemQrCode: loan.itemQrCode,
          type: 'belum_dikembalikan',
          subject: `[PERINGATAN] Barang Belum Dikembalikan: "${loan.itemName}" (${loan.itemQrCode})`,
          body: `Yth. ${loan.userName} (${loan.userDepartment}),\n\nBerdasarkan catatan sistem SiPinjam, barang "${loan.itemName}" (Kode QR: ${loan.itemQrCode}, Jumlah: ${loan.quantity} unit) telah melewati batas waktu pengembalian pada ${dueFormatted} (${dueInfo.label}) dan tercatat BELUM DIKEMBALIKAN.\n\nMohon segera mengembalikan barang ke lokasi penyimpanan dan melakukan scan QR pengembalian beserta bukti foto.`,
          sentAt: referenceTimeIso,
          read: false,
        };
        newNotifications.push(notif);
      }
      loan.overdueEmailSentAt = referenceTimeIso;
    }
  }

  return { newNotifications, updatedLoans };
}

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Aggregates loan records into monthly reports sorted newest first.
 */
export function computeMonthlyLoanReport(
  loans: LoanRecord[],
  referenceTimeIso: string = new Date().toISOString()
): MonthlyLoanSummary[] {
  const groups = new Map<
    string,
    {
      loans: LoanRecord[];
      categoryCount: Map<string, number>;
    }
  >();

  for (const loan of loans) {
    const dt = new Date(loan.borrowDate);
    if (Number.isNaN(dt.getTime())) continue;
    const year = dt.getUTCFullYear();
    const monthIndex = dt.getUTCMonth();
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    if (!groups.has(monthKey)) {
      groups.set(monthKey, { loans: [], categoryCount: new Map() });
    }
    const g = groups.get(monthKey)!;
    g.loans.push(loan);
    g.categoryCount.set(
      loan.itemCategory,
      (g.categoryCount.get(loan.itemCategory) || 0) + loan.quantity
    );
  }

  const summaries: MonthlyLoanSummary[] = [];
  for (const [monthKey, data] of groups.entries()) {
    const [yearStr, monthStr] = monthKey.split('-');
    const monthIdx = Number.parseInt(monthStr, 10) - 1;
    const monthLabel = `${INDONESIAN_MONTHS[monthIdx] || monthStr} ${yearStr}`;

    let activeLoans = 0;
    let returnedLoans = 0;
    let overdueCount = 0;
    let totalUnitsBorrowed = 0;

    for (const l of data.loans) {
      totalUnitsBorrowed += l.quantity;
      if (l.status === 'dikembalikan') {
        returnedLoans++;
      } else {
        activeLoans++;
        const due = calculateDueState(l, referenceTimeIso);
        if (due.state === 'terlambat') {
          overdueCount++;
        }
      }
    }

    let topCategory = '-';
    let maxCat = 0;
    for (const [cat, cnt] of data.categoryCount.entries()) {
      if (cnt > maxCat) {
        maxCat = cnt;
        topCategory = cat;
      }
    }

    summaries.push({
      monthKey,
      monthLabel,
      totalLoans: data.loans.length,
      activeLoans,
      returnedLoans,
      overdueCount,
      totalUnitsBorrowed,
      topCategory,
    });
  }

  return summaries.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

/**
 * Validates member borrow submission.
 */
export function validateBorrowRequest(params: {
  item?: InventoryItem;
  quantity: number;
  borrowDate: string;
  dueDate: string;
  purposeNotes: string;
  borrowPhotoDataUrl: string;
}): { valid: boolean; error?: string } {
  const { item, quantity, borrowDate, dueDate, purposeNotes, borrowPhotoDataUrl } =
    params;

  if (!item) {
    return {
      valid: false,
      error: 'Barang tidak ditemukan. Silakan scan atau pilih Kode QR barang yang valid.',
    };
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { valid: false, error: 'Jumlah unit pinjam minimal 1.' };
  }
  if (quantity > item.availableStock) {
    return {
      valid: false,
      error: `Stok tidak mencukupi. Tersedia: ${item.availableStock} unit.`,
    };
  }
  const bTime = new Date(borrowDate).getTime();
  const dTime = new Date(dueDate).getTime();
  if (Number.isNaN(bTime) || Number.isNaN(dTime) || dTime <= bTime) {
    return {
      valid: false,
      error: 'Tanggal pengembalian harus setelah waktu peminjaman.',
    };
  }
  if (!purposeNotes || purposeNotes.trim().length < 5) {
    return {
      valid: false,
      error: 'Catatan kebutuhan pemakaian wajib diisi (minimal 5 karakter).',
    };
  }
  if (!borrowPhotoDataUrl || !borrowPhotoDataUrl.startsWith('data:image')) {
    return {
      valid: false,
      error: 'Bukti foto kondisi barang wajib dilampirkan sebelum meminjam.',
    };
  }

  return { valid: true };
}

/**
 * Authenticates a user by email and password, optionally enforcing the selected login role tab.
 */
export function authenticateUser(
  users: User[],
  email: string,
  password: string,
  expectedRole?: UserRole
): { user?: User; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password.trim();
  if (!cleanEmail || !cleanPassword) {
    return { error: 'Email dan password wajib diisi.' };
  }
  const matched = users.find(
    (u) =>
      u.email.trim().toLowerCase() === cleanEmail &&
      (u.password === password || u.password.trim() === cleanPassword)
  );
  if (!matched) {
    return { error: 'Email atau password tidak sesuai.' };
  }
  if (expectedRole && matched.role !== expectedRole) {
    const roleLabel = matched.role === 'admin' ? 'Admin' : 'Anggota';
    return {
      error: `Akun ini terdaftar sebagai ${roleLabel}. Silakan pilih tab "Login ${roleLabel}" untuk masuk.`,
    };
  }
  if (!matched.active) {
    return { error: 'Akun anggota ini sedang dinonaktifkan oleh Admin.' };
  }
  return { user: matched };
}
