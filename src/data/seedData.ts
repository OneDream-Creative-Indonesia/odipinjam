import {
  BulkInventoryRowInput,
  InventoryItem,
  LoanRecord,
  User,
} from '../types/inventory';

/**
 * Generates a clean SVG illustration data URL for an inventory item photo preview.
 */
export function createSampleItemIllustrationSvg(params: {
  name: string;
  category: string;
  accentHex?: string;
}): string {
  const accent = params.accentHex || '#0284c7';
  const safeName = params.name.replace(/[<>&"]/g, '').slice(0, 32);
  const safeCategory = params.category.replace(/[<>&"]/g, '').slice(0, 24);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <defs>
      <linearGradient id="itemBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc"/>
        <stop offset="100%" stop-color="#e2e8f0"/>
      </linearGradient>
    </defs>
    <rect width="480" height="320" rx="16" fill="url(#itemBg)"/>
    <rect x="20" y="20" width="440" height="280" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <rect x="170" y="64" width="140" height="96" rx="14" fill="#f1f5f9" stroke="${accent}" stroke-width="2.5"/>
    <circle cx="240" cy="112" r="26" fill="#ffffff" stroke="${accent}" stroke-width="2.5"/>
    <circle cx="240" cy="112" r="10" fill="${accent}" opacity="0.35"/>
    <rect x="215" y="52" width="50" height="12" rx="4" fill="${accent}" opacity="0.7"/>
    <text x="240" y="204" text-anchor="middle" fill="${accent}" font-family="monospace" font-size="12" font-weight="bold">${safeCategory.toUpperCase()}</text>
    <text x="240" y="232" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="16" font-weight="bold">${safeName}</text>
    <text x="240" y="256" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="11">Foto Fisik Inventaris Barang</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

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

export const SAMPLE_BULK_TEMPLATE_ROWS: BulkInventoryRowInput[] = [
  {
    name: 'Kamera Mirrorless Sony A7 IV',
    category: 'Fotografi',
    totalStock: 3,
    location: 'Lemari A-01',
    condition: 'Baik',
    customQr: '',
    description:
      'Kamera full-frame beserta lensa 28-70mm dan baterai cadangan',
    imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
  },
  {
    name: 'Proyektor Epson EB-X51',
    category: 'Multimedia',
    totalStock: 4,
    location: 'Ruang AV-02',
    condition: 'Baik',
    customQr: '',
    description:
      'Proyektor XGA 3800 lumens lengkap dengan kabel HDMI & remote',
    imageUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=600&q=80',
  },
  {
    name: 'Mikrofon Wireless Shure BLX288',
    category: 'Audio',
    totalStock: 2,
    location: 'Rak Audio B-01',
    condition: 'Baik',
    customQr: '',
    description:
      'Dual mikrofon wireless UHF beserta receiver dan koper',
    imageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=600&q=80',
  },
];

export const BULK_TEMPLATE_HEADERS = [
  'Nama Barang',
  'Kategori',
  'Total Stok',
  'Lokasi',
  'Kondisi',
  'Kode QR',
  'Deskripsi',
  'Gambar Barang',
];

export const SAMPLE_BULK_CSV_TEMPLATE = [
  'sep=;',
  BULK_TEMPLATE_HEADERS.join(';'),
  ...SAMPLE_BULK_TEMPLATE_ROWS.map((r) =>
    [
      r.name,
      r.category,
      r.totalStock,
      r.location,
      r.condition,
      r.customQr || '',
      r.description || '',
      r.imageUrl || '',
    ].join(';')
  ),
].join('\r\n');
