export type UserRole = 'admin' | 'anggota';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  department: string;
  phone: string;
  createdAt: string;
  active: boolean;
}

export interface InventoryItem {
  id: string;
  qrCode: string;
  name: string;
  category: string;
  totalStock: number;
  availableStock: number;
  location: string;
  condition: 'Baik' | 'Perlu Perawatan';
  description: string;
  imageUrl?: string;
  createdAt: string;
}

export interface BulkInventoryRowInput {
  name: string;
  category: string;
  totalStock: string | number;
  location: string;
  condition: string;
  customQr?: string;
  description?: string;
  imageUrl?: string;
}

export type LoanStatus = 'dipinjam' | 'dikembalikan';

export type DueState = 'aman' | 'hampir_habis' | 'terlambat' | 'selesai';

export interface LoanRecord {
  id: string;
  itemId: string;
  itemQrCode: string;
  itemName: string;
  itemCategory: string;
  userId: string;
  userName: string;
  userEmail: string;
  userDepartment: string;
  quantity: number;
  borrowDate: string; // ISO string
  dueDate: string; // ISO string
  returnDate?: string; // ISO string
  durationDays: number;
  purposeNotes: string;
  returnNotes?: string;
  borrowPhotoDataUrl: string;
  returnPhotoDataUrl?: string;
  status: LoanStatus;
  reminderSentAt?: string;
  overdueEmailSentAt?: string;
}

export type EmailNotificationType =
  | 'batas_waktu_hampir_habis'
  | 'belum_dikembalikan'
  | 'konfirmasi_peminjaman'
  | 'konfirmasi_pengembalian';

export interface EmailNotification {
  id: string;
  recipientEmail: string;
  recipientName: string;
  userId: string;
  loanId: string;
  itemName: string;
  itemQrCode: string;
  type: EmailNotificationType;
  subject: string;
  body: string;
  sentAt: string;
  read: boolean;
  deliveryStatus?: 'sent' | 'pending' | 'failed';
  deliveryError?: string;
}

export interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  senderName: string;
  enabled: boolean;
}

export interface MonthlyLoanSummary {
  monthKey: string; // YYYY-MM
  monthLabel: string;
  totalLoans: number;
  activeLoans: number;
  returnedLoans: number;
  overdueCount: number;
  totalUnitsBorrowed: number;
  topCategory: string;
}
