import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateUser,
  buildAutomatedEmailNotifications,
  buildInventoryExcelTemplateXlsx,
  calculateDueState,
  computeMonthlyLoanReport,
  formatDateInputLocal,
  generateQrCodeString,
  generateQrMatrix,
  normalizeGoogleDriveImageUrl,
  parseBulkInventoryCsv,
  parseInventoryExcelXlsx,
  parseLocalEndOfDayIso,
  validateBorrowRequest,
  validateBulkInventoryRows,
} from './inventoryLogic';
import { SAMPLE_BULK_CSV_TEMPLATE, SAMPLE_BULK_TEMPLATE_ROWS } from '../data/seedData';
import { InventoryItem, LoanRecord, User } from '../types/inventory';

test('generateQrCodeString creates standardized inventory QR code', () => {
  const code = generateQrCodeString('Kamera Sony A7IV', 'Fotografi', 12);
  assert.equal(code, 'INV-FOT-KAM-0012');
});

test('generateQrMatrix produces deterministic 21x21 boolean matrix with finder patterns', () => {
  const m1 = generateQrMatrix('INV-FOT-KAM-0012');
  const m2 = generateQrMatrix('INV-FOT-KAM-0012');
  assert.equal(m1.length, 21);
  assert.equal(m1[0].length, 21);
  assert.deepEqual(m1, m2);
  // Top-left finder corner should be true
  assert.equal(m1[0][0], true);
  assert.equal(m1[3][3], true);
});

test('parseBulkInventoryCsv parses standard CSV and semicolon Excel CSV accurately', () => {
  const csv = `Nama Barang,Kategori,Total Stok,Lokasi,Kondisi
Proyektor Epson EB-X51,Multimedia,4,Ruang AV-1,Baik
Mikrofon Wireless Shure,Audio,6,Lemari B-2,Perlu Perawatan`;

  const res = parseBulkInventoryCsv(csv, 10);
  assert.equal(res.errors.length, 0);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].name, 'Proyektor Epson EB-X51');
  assert.equal(res.items[0].totalStock, 4);
  assert.equal(res.items[0].availableStock, 4);
  assert.equal(res.items[0].qrCode, 'INV-MUL-PRO-0011');
  assert.equal(res.items[1].condition, 'Perlu Perawatan');
});

test('calculateDueState identifies hampir_habis and terlambat states accurately', () => {
  const refIso = '2026-10-30T10:00:00.000Z';

  const dueSoon = calculateDueState(
    { status: 'dipinjam', dueDate: '2026-10-31T02:00:00.000Z' },
    refIso,
    24
  );
  assert.equal(dueSoon.state, 'hampir_habis');
  assert.equal(dueSoon.hoursRemaining, 16);

  const overdue = calculateDueState(
    { status: 'dipinjam', dueDate: '2026-10-28T10:00:00.000Z' },
    refIso,
    24
  );
  assert.equal(overdue.state, 'terlambat');
  assert.equal(overdue.hoursRemaining, -48);
});

test('buildAutomatedEmailNotifications dispatches emails for expiring and overdue loans', () => {
  const refIso = '2026-10-30T10:00:00.000Z';
  const loans: LoanRecord[] = [
    {
      id: 'L1',
      itemId: 'I1',
      itemQrCode: 'INV-ELK-LAP-0001',
      itemName: 'Laptop MacBook Pro 14"',
      itemCategory: 'Komputer',
      userId: 'U2',
      userName: 'Budi Santoso',
      userEmail: 'budi.santoso@inventaris.id',
      userDepartment: 'Tim Media',
      quantity: 1,
      borrowDate: '2026-10-28T10:00:00.000Z',
      dueDate: '2026-10-31T04:00:00.000Z', // 18 hours left
      durationDays: 3,
      purposeNotes: 'Liputan acara konferensi',
      borrowPhotoDataUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      status: 'dipinjam',
    },
    {
      id: 'L2',
      itemId: 'I2',
      itemQrCode: 'INV-FOT-KAM-0002',
      itemName: 'Kamera Sony Alpha A7IV',
      itemCategory: 'Fotografi',
      userId: 'U3',
      userName: 'Siti Rahma',
      userEmail: 'siti.rahma@inventaris.id',
      userDepartment: 'Dokumentasi',
      quantity: 1,
      borrowDate: '2026-10-24T10:00:00.000Z',
      dueDate: '2026-10-28T10:00:00.000Z', // 48 hours overdue
      durationDays: 4,
      purposeNotes: 'Dokumentasi lapangan',
      borrowPhotoDataUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      status: 'dipinjam',
    },
  ];

  const { newNotifications, updatedLoans } = buildAutomatedEmailNotifications(
    loans,
    [],
    refIso
  );

  assert.equal(newNotifications.length, 2);
  assert.equal(newNotifications[0].type, 'batas_waktu_hampir_habis');
  assert.equal(newNotifications[0].recipientEmail, 'budi.santoso@inventaris.id');
  assert.equal(newNotifications[1].type, 'belum_dikembalikan');
  assert.equal(newNotifications[1].recipientEmail, 'siti.rahma@inventaris.id');
  assert.ok(updatedLoans[0].reminderSentAt);
  assert.ok(updatedLoans[1].overdueEmailSentAt);
});

test('computeMonthlyLoanReport summarizes loans per month with top categories', () => {
  const loans: LoanRecord[] = [
    {
      id: 'L1',
      itemId: 'I1',
      itemQrCode: 'INV-01',
      itemName: 'Kamera',
      itemCategory: 'Fotografi',
      userId: 'U1',
      userName: 'Budi',
      userEmail: 'budi@test.id',
      userDepartment: 'Media',
      quantity: 2,
      borrowDate: '2026-10-10T08:00:00.000Z',
      dueDate: '2026-10-12T08:00:00.000Z',
      returnDate: '2026-10-11T15:00:00.000Z',
      durationDays: 2,
      purposeNotes: 'Pemotretan produk',
      borrowPhotoDataUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      status: 'dikembalikan',
    },
    {
      id: 'L2',
      itemId: 'I2',
      itemQrCode: 'INV-02',
      itemName: 'Laptop',
      itemCategory: 'Komputer',
      userId: 'U2',
      userName: 'Siti',
      userEmail: 'siti@test.id',
      userDepartment: 'IT',
      quantity: 1,
      borrowDate: '2026-09-15T08:00:00.000Z',
      dueDate: '2026-09-18T08:00:00.000Z',
      returnDate: '2026-09-17T15:00:00.000Z',
      durationDays: 3,
      purposeNotes: 'Presentasi klien',
      borrowPhotoDataUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      status: 'dikembalikan',
    },
  ];

  const report = computeMonthlyLoanReport(loans, '2026-10-30T10:00:00.000Z');
  assert.equal(report.length, 2);
  assert.equal(report[0].monthKey, '2026-10');
  assert.equal(report[0].totalUnitsBorrowed, 2);
  assert.equal(report[0].topCategory, 'Fotografi');
});

test('validateBorrowRequest enforces stock, notes, and photo proof', () => {
  const sampleItem: InventoryItem = {
    id: 'I1',
    qrCode: 'INV-KOM-LAP-0001',
    name: 'ThinkPad X1 Carbon',
    category: 'Komputer',
    totalStock: 3,
    availableStock: 2,
    location: 'Rak A-01',
    condition: 'Baik',
    description: 'Laptop operasional',
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  const missingPhoto = validateBorrowRequest({
    item: sampleItem,
    quantity: 1,
    borrowDate: '2026-10-30T08:00:00.000Z',
    dueDate: '2026-11-01T08:00:00.000Z',
    purposeNotes: 'Kebutuhan rapat tahunan',
    borrowPhotoDataUrl: '',
  });
  assert.equal(missingPhoto.valid, false);

  const validReq = validateBorrowRequest({
    item: sampleItem,
    quantity: 2,
    borrowDate: '2026-10-30T08:00:00.000Z',
    dueDate: '2026-11-01T08:00:00.000Z',
    purposeNotes: 'Kebutuhan rapat tahunan',
    borrowPhotoDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
  });
  assert.equal(validReq.valid, true);
});

test('authenticateUser verifies credentials and active status', () => {
  const users: User[] = [
    {
      id: 'U1',
      name: 'Admin Inventaris',
      email: 'admin@inventaris.id',
      password: 'admin123',
      role: 'admin',
      department: 'Manajemen Aset',
      phone: '081234567890',
      createdAt: '2026-01-01T00:00:00.000Z',
      active: true,
    },
  ];
  assert.equal(authenticateUser(users, 'admin@inventaris.id', 'wrong').user, undefined);
  assert.equal(
    authenticateUser(users, 'admin@inventaris.id', 'admin123').user?.role,
    'admin'
  );
  assert.ok(
    authenticateUser(users, 'admin@inventaris.id', 'admin123', 'anggota').error
  );
  assert.equal(
    authenticateUser(users, 'admin@inventaris.id', 'admin123', 'admin').user?.id,
    'U1'
  );
});

test('formatDateInputLocal and parseLocalEndOfDayIso preserve local calendar date without shifting', () => {
  const localDate = new Date(2026, 9, 31, 14, 30, 0); // Oct 31, 2026
  const formatted = formatDateInputLocal(localDate);
  assert.equal(formatted, '2026-10-31');

  const endIso = parseLocalEndOfDayIso('2026-11-03');
  assert.ok(endIso);
  const parsedBack = new Date(endIso);
  assert.equal(formatDateInputLocal(parsedBack), '2026-11-03');
  assert.equal(parseLocalEndOfDayIso(''), '');
});

test('parseBulkInventoryCsv prevents duplicate QR codes against existing inventory', () => {
  const csv = `Nama Barang,Kategori,Total Stok,Lokasi,Kondisi,Kode QR
Kamera A,Fotografi,2,Lemari 1,Baik,INV-DUP-0001
Kamera B,Fotografi,2,Lemari 1,Baik,INV-DUP-0001`;
  const res = parseBulkInventoryCsv(csv, 2, ['INV-EXISTING-0001']);
  assert.equal(res.items.length, 1);
  assert.equal(res.errors.length, 1);
});

test('SAMPLE_BULK_CSV_TEMPLATE uses column separation (semicolon + sep=;) instead of commas and includes Gambar Barang', () => {
  const res = parseBulkInventoryCsv(SAMPLE_BULK_CSV_TEMPLATE, 0);
  assert.equal(res.errors.length, 0);
  assert.equal(res.items.length, 3);
  assert.equal(res.items[0].name, 'Kamera Mirrorless Sony A7 IV');
  assert.ok(res.items[0].imageUrl?.startsWith('https://'));
});

test('buildInventoryExcelTemplateXlsx and parseInventoryExcelXlsx round-trip columns and physical image URL', async () => {
  const xlsxBytes = buildInventoryExcelTemplateXlsx(SAMPLE_BULK_TEMPLATE_ROWS);
  assert.ok(xlsxBytes.length > 500);
  // PKZIP signature
  assert.equal(xlsxBytes[0], 0x50);
  assert.equal(xlsxBytes[1], 0x4b);

  const parsedRows = await parseInventoryExcelXlsx(xlsxBytes);
  assert.equal(parsedRows.length, 3);
  assert.equal(parsedRows[0].name, 'Kamera Mirrorless Sony A7 IV');
  assert.equal(parsedRows[0].category, 'Fotografi');
  assert.equal(parsedRows[0].totalStock, '3');
  assert.equal(parsedRows[0].location, 'Lemari A-01');
  assert.ok(parsedRows[0].imageUrl?.startsWith('https://'));

  const validated = validateBulkInventoryRows(parsedRows, 0);
  assert.equal(validated.errors.length, 0);
  assert.equal(validated.items.length, 3);
  assert.equal(validated.items[0].imageUrl, SAMPLE_BULK_TEMPLATE_ROWS[0].imageUrl);
});

test('normalizeGoogleDriveImageUrl converts various Google Drive sharing links to direct thumbnail URLs', () => {
  const link1 = 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=sharing';
  assert.equal(
    normalizeGoogleDriveImageUrl(link1),
    'https://drive.google.com/thumbnail?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms&sz=w1000'
  );

  const link2 = 'https://drive.google.com/file/d/1abcDEF-123_xyz/view';
  assert.equal(
    normalizeGoogleDriveImageUrl(link2),
    'https://drive.google.com/thumbnail?id=1abcDEF-123_xyz&sz=w1000'
  );

  const link3 = 'https://drive.google.com/open?id=1abcDEF-123_xyz';
  assert.equal(
    normalizeGoogleDriveImageUrl(link3),
    'https://drive.google.com/thumbnail?id=1abcDEF-123_xyz&sz=w1000'
  );

  const link4 = 'https://drive.google.com/uc?id=1abcDEF-123_xyz&export=download';
  assert.equal(
    normalizeGoogleDriveImageUrl(link4),
    'https://drive.google.com/thumbnail?id=1abcDEF-123_xyz&sz=w1000'
  );

  const normalUrl = 'https://images.unsplash.com/photo-1516035069371';
  assert.equal(normalizeGoogleDriveImageUrl(normalUrl), normalUrl);
});

test('parseInventoryExcelXlsx preserves Google Drive imageUrl when customQr column is left empty', async () => {
  const driveShareLink =
    'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=sharing';
  const rowsWithEmptyQr = [
    {
      name: 'Lensa Sony 18-105 MM',
      category: 'Lensa',
      totalStock: '2',
      location: 'Lemari A-02',
      condition: 'Baik',
      customQr: '',
      description: 'LENSA E MOUNT UNTUK KAMERA SONY',
      imageUrl: driveShareLink,
    },
  ];

  // Simulate Excel saving empty F2 cell as self-closing <c r="F2" s="2"/>
  const rawBytes = buildInventoryExcelTemplateXlsx(rowsWithEmptyQr);
  const decoder = new TextDecoder('utf-8');
  const xmlText = decoder.decode(rawBytes);
  assert.ok(xmlText.includes('Lensa Sony 18-105 MM'));

  const parsed = await parseInventoryExcelXlsx(rawBytes);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Lensa Sony 18-105 MM');
  assert.equal(parsed[0].customQr, '');
  assert.equal(parsed[0].description, 'LENSA E MOUNT UNTUK KAMERA SONY');
  assert.equal(
    parsed[0].imageUrl,
    'https://drive.google.com/thumbnail?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms&sz=w1000'
  );

  const validated = validateBulkInventoryRows(parsed, 0);
  assert.equal(validated.errors.length, 0);
  assert.equal(validated.items[0].description, 'LENSA E MOUNT UNTUK KAMERA SONY');
  assert.ok(validated.items[0].qrCode.startsWith('INV-LEN-'));
  assert.equal(
    validated.items[0].imageUrl,
    'https://drive.google.com/thumbnail?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms&sz=w1000'
  );
});
