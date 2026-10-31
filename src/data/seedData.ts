import {
  InventoryItem,
  LoanRecord,
  User,
} from '../types/inventory';

/**
 * Generates a timestamped verification photo data URL when a user captures a handover proof.
 */
export function createEquipmentPhotoProofSvg(params: {
  title: string;
  qrCode: string;
  actorName: string;
  timestampLabel: string;
  badgeText: string;
  accentHex?: string;
}): string {
  const accent = params.accentHex || '#0284c7';
  const safeTitle = params.title.replace(/[<>&"]/g, '');
  const safeQr = params.qrCode.replace(/[<>&"]/g, '');
  const safeActor = params.actorName.replace(/[<>&"]/g, '');
  const safeTime = params.timestampLabel.replace(/[<>&"]/g, '');
  const safeBadge = params.badgeText.replace(/[<>&"]/g, '');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="640" height="420" fill="url(#bg)"/>
    <rect x="24" y="24" width="592" height="372" rx="12" fill="none" stroke="#334155" stroke-width="2" stroke-dasharray="8 6"/>
    <path d="M44 68 V44 H68" fill="none" stroke="${accent}" stroke-width="3"/>
    <path d="M596 68 V44 H572" fill="none" stroke="${accent}" stroke-width="3"/>
    <path d="M44 352 V376 H68" fill="none" stroke="${accent}" stroke-width="3"/>
    <path d="M596 352 V376 H572" fill="none" stroke="${accent}" stroke-width="3"/>
    <rect x="220" y="95" width="200" height="130" rx="14" fill="#1e293b" stroke="#64748b" stroke-width="2.5"/>
    <circle cx="320" cy="160" r="36" fill="#0f172a" stroke="${accent}" stroke-width="3"/>
    <circle cx="320" cy="160" r="14" fill="${accent}" opacity="0.4"/>
    <rect x="285" y="78" width="70" height="17" rx="4" fill="#334155"/>
    <rect x="44" y="256" width="552" height="104" rx="8" fill="#090d16" opacity="0.86"/>
    <text x="64" y="284" fill="${accent}" font-family="monospace" font-size="13" font-weight="bold">${safeBadge} · ${safeQr}</text>
    <text x="64" y="310" fill="#f8fafc" font-family="sans-serif" font-size="18" font-weight="bold">${safeTitle}</text>
    <text x="64" y="338" fill="#94a3b8" font-family="monospace" font-size="13">Petugas/Peminjam: ${safeActor} | Waktu: ${safeTime}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Clean production initial state:
 * Only the primary Administrator account is initialized so the owner can log in
 * and manage real inventory items and real member accounts.
 */
export const INITIAL_USERS: User[] = [
  {
    id: 'usr-admin-master',
    name: 'Administrator Utama',
    email: 'onedreamcreativeindonesia@gmail.com',
    password: 'MenyatukanMIMPI21',
    role: 'admin',
    department: 'Manajemen Inventaris',
    phone: '-',
    createdAt: new Date().toISOString(),
    active: true,
  },
];

export const INITIAL_ITEMS: InventoryItem[] = [];

export function createInitialLoans(_nowIso?: string): LoanRecord[] {
  return [];
}

export const SAMPLE_BULK_CSV_TEMPLATE = `Nama Barang,Kategori,Total Stok,Lokasi,Kondisi,Kode QR,Deskripsi`;
