import {
  DueState,
  EmailNotification,
  InventoryItem,
  LoanRecord,
  MonthlyLoanSummary,
  User,
} from '../types/inventory';

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
 * Generates a deterministic 21x21 QR-Code matrix with standard finder patterns,
 * timing lines, and encoded payload bits for crisp SVG rendering.
 */
export function generateQrMatrix(text: string, size = 21): boolean[][] {
  const n = Math.max(21, size);
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

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    reserved[6][i] = true;
    matrix[6][i] = i % 2 === 0;
    reserved[i][6] = true;
    matrix[i][6] = i % 2 === 0;
  }

  // Deterministic bit stream from text
  const payload = text.trim() || 'INV-DEFAULT';
  const bits: boolean[] = [];
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    hash ^= code;
    hash = Math.imul(hash, 16777619);
    for (let b = 7; b >= 0; b--) {
      bits.push(((code >> b) & 1) === 1);
    }
  }
  // Pad bits deterministically
  for (let i = 0; i < n * n; i++) {
    hash ^= (i + 1) * 31;
    hash = Math.imul(hash, 16777619);
    bits.push((Math.abs(hash) & 1) === 1);
  }

  let bitIdx = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!reserved[r][c]) {
        const mask = (r + c) % 2 === 0;
        matrix[r][c] = bits[bitIdx % bits.length] !== mask;
        bitIdx++;
      }
    }
  }

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
 * Parses CSV, semicolon-delimited Excel CSV, or TSV spreadsheet rows into inventory items.
 * Expected columns (header optional):
 * Nama Barang, Kategori, Total Stok, Lokasi, Kondisi, Kode QR (opsional), Deskripsi (opsional)
 */
export function parseBulkInventoryCsv(
  rawText: string,
  existingCount: number
): {
  items: Omit<InventoryItem, 'id' | 'createdAt'>[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { items: [], errors: ['File atau teks CSV kosong.'] };
  }

  const detectDelimiter = (sample: string): string => {
    if (sample.includes('\t')) return '\t';
    const semiCount = (sample.match(/;/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    return semiCount > commaCount ? ';' : ',';
  };

  const delimiter = detectDelimiter(lines[0]);

  const splitRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
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
    firstRowCols.some((c) => c.includes('kategori') || c.includes('category') || c.includes('stok'));

  const startIdx = hasHeader ? 1 : 0;
  const items: Omit<InventoryItem, 'id' | 'createdAt'>[] = [];
  const errors: string[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const rowNum = i + 1;

    const name = (cols[0] || '').trim();
    const category = (cols[1] || 'Umum').trim() || 'Umum';
    const stockRaw = (cols[2] || '1').trim();
    const location = (cols[3] || 'Gudang Utama').trim() || 'Gudang Utama';
    const conditionRaw = (cols[4] || 'Baik').trim();
    const customQr = (cols[5] || '').trim();
    const description = (cols[6] || `Barang inventaris kategori ${category}`).trim();

    if (!name) {
      errors.push(`Baris ${rowNum}: Nama barang wajib diisi.`);
      continue;
    }

    const parsedStock = Number.parseInt(stockRaw, 10);
    if (Number.isNaN(parsedStock) || parsedStock <= 0) {
      errors.push(`Baris ${rowNum} ("${name}"): Jumlah stok harus berupa angka positif.`);
      continue;
    }

    const condition: 'Baik' | 'Perlu Perawatan' =
      conditionRaw.toLowerCase().includes('rawat') ||
      conditionRaw.toLowerCase().includes('perlu')
        ? 'Perlu Perawatan'
        : 'Baik';

    const qrCode =
      customQr ||
      generateQrCodeString(name, category, existingCount + items.length + 1);

    items.push({
      qrCode,
      name,
      category,
      totalStock: parsedStock,
      availableStock: parsedStock,
      location,
      condition,
      description,
    });
  }

  return { items, errors };
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
          subject: `[Pengingat ODipinjam] Batas Waktu Peminjaman "${loan.itemName}" Hampir Habis`,
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
          body: `Yth. ${loan.userName} (${loan.userDepartment}),\n\nBerdasarkan catatan sistem ODipinjam, barang "${loan.itemName}" (Kode QR: ${loan.itemQrCode}, Jumlah: ${loan.quantity} unit) telah melewati batas waktu pengembalian pada ${dueFormatted} (${dueInfo.label}) dan tercatat BELUM DIKEMBALIKAN.\n\nMohon segera mengembalikan barang ke lokasi penyimpanan dan melakukan scan QR pengembalian beserta bukti foto.`,
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
 * Authenticates a user by email and password.
 */
export function authenticateUser(
  users: User[],
  email: string,
  password: string
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
  if (!matched.active) {
    return { error: 'Akun anggota ini sedang dinonaktifkan oleh Admin.' };
  }
  return { user: matched };
}
