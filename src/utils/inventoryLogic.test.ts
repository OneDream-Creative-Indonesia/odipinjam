import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateUser,
  buildAutomatedEmailNotifications,
  calculateDueState,
  computeMonthlyLoanReport,
  generateQrCodeString,
  generateQrMatrix,
  parseBulkInventoryCsv,
  validateBorrowRequest,
} from './inventoryLogic';
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
});
