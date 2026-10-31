import React, { useMemo, useRef, useState } from 'react';
import {
  EmailNotification,
  InventoryItem,
  LoanRecord,
  User,
} from '../types/inventory';
import {
  calculateDueState,
  validateBorrowRequest,
} from '../utils/inventoryLogic';
import { createEquipmentPhotoProofSvg } from '../data/seedData';
import { QrCodeSvg } from './QrCodeSvg';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Mail,
  Package,
  QrCode,
  RotateCcw,
  ScanLine,
  Upload,
} from 'lucide-react';

interface MemberPortalViewProps {
  currentUser: User;
  activeTab: 'catalog' | 'borrow' | 'return' | 'notifications';
  onChangeTab: (tab: 'catalog' | 'borrow' | 'return' | 'notifications') => void;
  items: InventoryItem[];
  loans: LoanRecord[];
  emails: EmailNotification[];
  referenceTimeIso: string;
  onBorrowItem: (payload: {
    item: InventoryItem;
    quantity: number;
    borrowDate: string;
    dueDate: string;
    durationDays: number;
    purposeNotes: string;
    borrowPhotoDataUrl: string;
  }) => void;
  onReturnItem: (payload: {
    loanId: string;
    returnNotes: string;
    returnPhotoDataUrl: string;
  }) => void;
  onMarkEmailsRead: (userId: string) => void;
}

export const MemberPortalView: React.FC<MemberPortalViewProps> = ({
  currentUser,
  activeTab,
  onChangeTab,
  items,
  loans,
  emails,
  referenceTimeIso,
  onBorrowItem,
  onReturnItem,
  onMarkEmailsRead,
}) => {
  // Borrow form state
  const [scannedQrCode, setScannedQrCode] = useState(() => items[0]?.qrCode || '');
  const [quantity, setQuantity] = useState(1);
  const [durationDays, setDurationDays] = useState(3);
  const [dueDateInput, setDueDateInput] = useState(() => {
    const dt = new Date(new Date(referenceTimeIso).getTime() + 3 * 86400 * 1000);
    return dt.toISOString().slice(0, 10);
  });
  const [purposeNotes, setPurposeNotes] = useState('');
  const [borrowPhotoDataUrl, setBorrowPhotoDataUrl] = useState('');
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [borrowSuccess, setBorrowSuccess] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatusMsg, setCameraStatusMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Return form state
  const [selectedReturnLoanId, setSelectedReturnLoanId] = useState<string>('');
  const [returnQrInput, setReturnQrInput] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [returnPhotoDataUrl, setReturnPhotoDataUrl] = useState<string>('');
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnSuccess, setReturnSuccess] = useState<string | null>(null);

  const myLoans = useMemo(
    () => loans.filter((l) => l.userId === currentUser.id),
    [loans, currentUser.id]
  );

  const myActiveLoans = useMemo(
    () => myLoans.filter((l) => l.status === 'dipinjam'),
    [myLoans]
  );

  const myEmails = useMemo(
    () =>
      emails.filter(
        (e) =>
          e.userId === currentUser.id ||
          e.recipientEmail.toLowerCase() === currentUser.email.toLowerCase()
      ),
    [emails, currentUser.id, currentUser.email]
  );

  const matchedItem = useMemo(() => {
    const clean = scannedQrCode.trim().toLowerCase();
    return items.find((i) => i.qrCode.toLowerCase() === clean);
  }, [items, scannedQrCode]);

  const activeReturnLoan = useMemo(() => {
    if (selectedReturnLoanId) {
      return myActiveLoans.find((l) => l.id === selectedReturnLoanId) || null;
    }
    if (returnQrInput.trim()) {
      return (
        myActiveLoans.find(
          (l) =>
            l.itemQrCode.toLowerCase() === returnQrInput.trim().toLowerCase()
        ) || null
      );
    }
    return myActiveLoans[0] || null;
  }, [myActiveLoans, selectedReturnLoanId, returnQrInput]);

  const handleDurationChange = (days: number) => {
    const safeDays = Math.max(1, Math.min(30, days));
    setDurationDays(safeDays);
    const target = new Date(
      new Date().getTime() + safeDays * 24 * 3600 * 1000
    );
    setDueDateInput(target.toISOString().slice(0, 10));
  };

  const handleDueDateInputChange = (dateStr: string) => {
    setDueDateInput(dateStr);
    const diffMs = new Date(dateStr).getTime() - new Date().getTime();
    const days = Math.max(1, Math.ceil(diffMs / (1000 * 3600 * 24)));
    setDurationDays(days);
  };

  const handleStartCameraScan = async () => {
    setCameraStatusMsg(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatusMsg(
        'Kamera tidak terdeteksi pada perangkat ini. Gunakan pemilih QR cepat atau unggah label QR.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraStatusMsg(
        'Izin kamera tidak tersedia di lingkungan pratinjau ini. Silakan klik salah satu Kode QR barang di bawah untuk simulasi scan instan.'
      );
    }
  };

  const handleStopCameraScan = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleBorrowPhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBorrowPhotoDataUrl(String(ev.target?.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleCaptureInstantBorrowPhoto = () => {
    const targetItem = matchedItem || items[0];
    const svgUrl = createEquipmentPhotoProofSvg({
      title: targetItem ? targetItem.name : 'Unit Inventaris',
      qrCode: targetItem ? targetItem.qrCode : scannedQrCode || 'INV-QR',
      actorName: currentUser.name,
      timestampLabel: new Date().toLocaleString('id-ID'),
      badgeText: 'BUKTI FOTO PINJAM',
      accentHex: '#0284c7',
    });
    setBorrowPhotoDataUrl(svgUrl);
  };

  const handleSubmitBorrow = (e: React.FormEvent) => {
    e.preventDefault();
    setBorrowError(null);
    setBorrowSuccess(null);

    const nowIso = new Date().toISOString();
    const dueIso = new Date(`${dueDateInput}T17:00:00.000Z`).toISOString();

    const validation = validateBorrowRequest({
      item: matchedItem,
      quantity,
      borrowDate: nowIso,
      dueDate: dueIso,
      purposeNotes,
      borrowPhotoDataUrl,
    });

    if (!validation.valid || !matchedItem) {
      setBorrowError(validation.error || 'Data peminjaman belum lengkap.');
      return;
    }

    onBorrowItem({
      item: matchedItem,
      quantity,
      borrowDate: nowIso,
      dueDate: dueIso,
      durationDays,
      purposeNotes: purposeNotes.trim(),
      borrowPhotoDataUrl,
    });

    setBorrowSuccess(
      `Peminjaman "${matchedItem.name}" (${matchedItem.qrCode}) sebanyak ${quantity} unit berhasil dicatat!`
    );
    setPurposeNotes('');
    setBorrowPhotoDataUrl('');
    setQuantity(1);
  };

  const handleReturnPhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReturnPhotoDataUrl(String(ev.target?.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleCaptureInstantReturnPhoto = () => {
    if (!activeReturnLoan) return;
    const svgUrl = createEquipmentPhotoProofSvg({
      title: activeReturnLoan.itemName,
      qrCode: activeReturnLoan.itemQrCode,
      actorName: currentUser.name,
      timestampLabel: new Date().toLocaleString('id-ID'),
      badgeText: 'BUKTI FOTO KEMBALI',
      accentHex: '#16a34a',
    });
    setReturnPhotoDataUrl(svgUrl);
  };

  const handleSubmitReturn = (e: React.FormEvent) => {
    e.preventDefault();
    setReturnError(null);
    setReturnSuccess(null);

    if (!activeReturnLoan) {
      setReturnError('Pilih atau scan QR barang yang sedang Anda pinjam.');
      return;
    }
    if (!returnPhotoDataUrl) {
      setReturnError(
        'Bukti foto pengembalian barang wajib dilampirkan sebelum menyelesaikan pengembalian.'
      );
      return;
    }

    onReturnItem({
      loanId: activeReturnLoan.id,
      returnNotes:
        returnNotes.trim() ||
        'Barang dikembalikan lengkap dalam kondisi berfungsi baik.',
      returnPhotoDataUrl,
    });

    setReturnSuccess(
      `Barang "${activeReturnLoan.itemName}" (${activeReturnLoan.itemQrCode}) telah berhasil dikembalikan ke inventaris.`
    );
    setReturnNotes('');
    setReturnPhotoDataUrl('');
    setReturnQrInput('');
    setSelectedReturnLoanId('');
  };

  return (
    <div className="space-y-8">
      {/* Member Alert Banner for Expiring / Overdue Loans */}
      {myActiveLoans.some((l) => {
        const d = calculateDueState(l, referenceTimeIso, 24);
        return d.state === 'hampir_habis' || d.state === 'terlambat';
      }) && (
          <section
            aria-label="Peringatan Peminjaman Anggota"
            className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Pengingat Batas Waktu Peminjaman Anda
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Anda memiliki barang pinjaman yang batas waktunya hampir habis atau belum dikembalikan. Periksa kotak masuk notifikasi email atau segera lakukan pengembalian.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onChangeTab('return')}
                className="px-3.5 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg whitespace-nowrap shrink-0 shadow-xs"
              >
                Kembalikan Barang
              </button>
              <button
                type="button"
                onClick={() => {
                  onMarkEmailsRead(currentUser.id);
                  onChangeTab('notifications');
                }}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
              >
                Buka Email ({myEmails.length})
              </button>
            </div>
          </section>
        )}

      {/* TAB 1: CATALOG & MY LOANS */}
      {activeTab === 'catalog' && (
        <div className="space-y-8">
          {/* Active Loans Summary */}
          <section
            aria-label="Peminjaman Aktif Saya"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Barang yang kamu Pinjam ({myActiveLoans.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onChangeTab('borrow')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg whitespace-nowrap shrink-0 shadow-xs"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Pinjam Barang
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Kode Barang</th>
                    <th className="py-3 px-4">Tanggal Pinjam · Jatuh Tempo</th>
                    <th className="py-3 px-4">Catatan Pemakaian</th>
                    <th className="py-3 px-4">Status Waktu</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {myActiveLoans.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Anda tidak memiliki peminjaman aktif saat ini.
                      </td>
                    </tr>
                  ) : (
                    myActiveLoans.map((loan) => {
                      const due = calculateDueState(loan, referenceTimeIso, 24);
                      return (
                        <tr key={loan.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">
                              {loan.itemName}
                            </p>
                            <p className="font-mono text-slate-500 mt-0.5 tabular-nums">
                              {loan.itemQrCode} · {loan.quantity} unit
                            </p>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {new Date(loan.borrowDate).toLocaleDateString('id-ID')}{' '}
                            &rarr;{' '}
                            <strong className="text-slate-900">
                              {new Date(loan.dueDate).toLocaleDateString('id-ID')}
                            </strong>
                          </td>
                          <td className="py-3 px-4 text-slate-700 max-w-xs">
                            {loan.purposeNotes}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {due.state === 'terlambat' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {due.label}
                              </span>
                            ) : due.state === 'hampir_habis' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                                <Clock className="w-3.5 h-3.5" />
                                {due.label}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {due.label}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedReturnLoanId(loan.id);
                                setReturnQrInput(loan.itemQrCode);
                                onChangeTab('return');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-md transition-colors shadow-xs"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Kembalikan
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: BORROW ITEM (SCAN QR + DURATION + NOTES + PHOTO PROOF) */}
      {activeTab === 'borrow' && (
        <section
          aria-label="Formulir Peminjaman Barang dengan Scan QR dan Bukti Foto"
          className="bg-white border border-slate-200 rounded-lg p-6"
        >
          <div className="pb-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Pinjam Barang
            </h2>
          </div>

          <form
            onSubmit={handleSubmitBorrow}
            className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            {/* Left Column: QR Scanner & Item Selection */}
            <div className="lg:col-span-5 space-y-4">
              <div>
                <label
                  htmlFor="scan-qr-input"
                  className="block text-xs font-semibold text-slate-800 mb-1.5"
                >
                  1. Scan atau Masukkan Kode QR Barang *
                </label>
                <div className="flex gap-2">
                  <input
                    id="scan-qr-input"
                    type="text"
                    value={scannedQrCode}
                    onChange={(e) => setScannedQrCode(e.target.value)}
                    placeholder="Contoh: INV-FOT-SON-0001"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                  <button
                    type="button"
                    onClick={
                      cameraActive ? handleStopCameraScan : handleStartCameraScan
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <ScanLine className="w-3.5 h-3.5 text-[#e71f69]" />
                    {cameraActive ? 'Tutup Kamera' : 'Kamera QR'}
                  </button>
                </div>
              </div>

              {cameraActive && (
                <div className="p-3 bg-slate-900 rounded-lg text-center space-y-2">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-40 object-cover rounded border border-slate-700"
                  />
                  <p className="text-xs text-slate-300">
                    Arahkan kamera ke stiker Kode QR pada barang...
                  </p>
                </div>
              )}

              {cameraStatusMsg && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  {cameraStatusMsg}
                </p>
              )}

              {/* Matched Item Card */}
              {matchedItem ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-4">
                  <QrCodeSvg value={matchedItem.qrCode} size={72} />
                  <div className="text-xs space-y-1">
                    <span className="font-mono font-semibold text-[#e71f69]">
                      TERDETEKSI · {matchedItem.qrCode}
                    </span>
                    <p className="font-semibold text-slate-900 text-sm">
                      {matchedItem.name}
                    </p>
                    <p className="text-slate-500">
                      {matchedItem.category} · {matchedItem.location} · Tersedia:{' '}
                      <strong className="font-mono text-slate-900">
                        {matchedItem.availableStock} unit
                      </strong>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  Kode QR tidak ditemukan dalam inventaris. Pastikan kode QR sesuai.
                </div>
              )}
            </div>

            {/* Right Column: Duration, Notes, and Photo Proof */}
            <div className="lg:col-span-7 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="borrow-qty-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Jumlah Unit Pinjam *
                  </label>
                  <input
                    id="borrow-qty-input"
                    type="number"
                    min={1}
                    max={matchedItem?.availableStock || 10}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="borrow-duration-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Durasi Pinjam (Hari) *
                  </label>
                  <input
                    id="borrow-duration-input"
                    type="number"
                    min={1}
                    max={30}
                    value={durationDays}
                    onChange={(e) =>
                      handleDurationChange(Number.parseInt(e.target.value, 10) || 1)
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="borrow-duedate-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Tanggal Pengembalian *
                  </label>
                  <input
                    id="borrow-duedate-input"
                    type="date"
                    value={dueDateInput}
                    onChange={(e) => handleDueDateInputChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="borrow-notes-textarea"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Catatan untuk Kebutuhan Pemakaian *
                </label>
                <textarea
                  id="borrow-notes-textarea"
                  rows={3}
                  value={purposeNotes}
                  onChange={(e) => setPurposeNotes(e.target.value)}
                  placeholder="Jelaskan keperluan pemakaian barang, lokasi kegiatan, dan penanggung jawab..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                />
              </div>

              {/* Photo Proof Attachment */}
              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-700">
                  Bukti Foto Kondisi Barang Saat Dipinjam *
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleCaptureInstantBorrowPhoto}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#e71f69] bg-[#e71f69]/10 hover:bg-[#e71f69]/20 border border-[#e71f69]/30 rounded-lg transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Ambil Foto Bukti Serah Terima (Kamera Instan)
                  </button>

                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    Unggah File Foto
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBorrowPhotoFile}
                      className="sr-only"
                    />
                  </label>
                </div>

                {borrowPhotoDataUrl && (
                  <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-w-sm bg-slate-900">
                    <img
                      src={borrowPhotoDataUrl}
                      alt="Pratinjau bukti foto peminjaman"
                      referrerPolicy="no-referrer"
                      className="w-full h-40 object-cover"
                    />
                  </div>
                )}
              </div>

              {borrowError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-600">
                  {borrowError}
                </div>
              )}

              {borrowSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{borrowSuccess}</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
                >
                  <Package className="w-4 h-4" />
                  Konfirmasi Peminjaman Barang
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* TAB 3: RETURN ITEM (SCAN QR + CONDITION NOTES + PHOTO PROOF) */}
      {activeTab === 'return' && (
        <section
          aria-label="Formulir Pengembalian Barang"
          className="bg-white border border-slate-200 rounded-lg p-6"
        >
          <div className="pb-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Pengembalian Barang Pinjaman
            </h2>
          </div>

          {myActiveLoans.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-900">
                Tidak Ada Barang yang Perlu Dikembalikan
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmitReturn}
              className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              <div className="lg:col-span-5 space-y-4">
                <div>
                  <label
                    htmlFor="return-loan-select"
                    className="block text-xs font-semibold text-slate-800 mb-1.5"
                  >
                    1. Pilih Pinjaman Aktif atau Scan Kode QR Barang *
                  </label>
                  <select
                    id="return-loan-select"
                    value={activeReturnLoan?.id || ''}
                    onChange={(e) => {
                      setSelectedReturnLoanId(e.target.value);
                      const found = myActiveLoans.find(
                        (l) => l.id === e.target.value
                      );
                      if (found) setReturnQrInput(found.itemQrCode);
                    }}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  >
                    {myActiveLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.itemQrCode} — {l.itemName} ({l.quantity} unit)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="return-qr-verify"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Verifikasi Scan Kode QR Barang
                  </label>
                  <input
                    id="return-qr-verify"
                    type="text"
                    value={returnQrInput || activeReturnLoan?.itemQrCode || ''}
                    onChange={(e) => setReturnQrInput(e.target.value)}
                    placeholder="Scan Kode QR untuk verifikasi..."
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                </div>

                {activeReturnLoan && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
                    <p className="font-mono font-semibold text-[#e71f69]">
                      {activeReturnLoan.itemQrCode}
                    </p>
                    <p className="font-semibold text-slate-900 text-sm">
                      {activeReturnLoan.itemName}
                    </p>
                    <p className="text-slate-600">
                      Jumlah: {activeReturnLoan.quantity} unit · Jatuh tempo:{' '}
                      {new Date(activeReturnLoan.dueDate).toLocaleDateString(
                        'id-ID'
                      )}
                    </p>
                    <p className="text-slate-500">
                      Catatan Pinjam: {activeReturnLoan.purposeNotes}
                    </p>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 space-y-5">
                <div>
                  <label
                    htmlFor="return-notes-textarea"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Catatan Kondisi Pengembalian Barang
                  </label>
                  <textarea
                    id="return-notes-textarea"
                    rows={3}
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Contoh: Dikembalikan lengkap beserta charger dan tas di Kabinet A-01..."
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                </div>

                <div className="space-y-2">
                  <span className="block text-xs font-medium text-slate-700">
                    Bukti Foto Barang Saat Dikembalikan *
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleCaptureInstantReturnPhoto}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Ambil Foto Bukti Pengembalian (Kamera Instan)
                    </button>

                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      Unggah File Foto Pengembalian
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleReturnPhotoFile}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {returnPhotoDataUrl && (
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-w-sm bg-slate-900">
                      <img
                        src={returnPhotoDataUrl}
                        alt="Pratinjau bukti foto pengembalian"
                        referrerPolicy="no-referrer"
                        className="w-full h-40 object-cover"
                      />
                    </div>
                  )}
                </div>

                {returnError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-600">
                    {returnError}
                  </div>
                )}

                {returnSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{returnSuccess}</span>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Selesaikan Pengembalian Barang
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      )}

      {/* TAB 4: MEMBER EMAIL NOTIFICATIONS INBOX */}
      {activeTab === 'notifications' && (
        <section
          aria-label="Kotak Masuk Email Pengingat Anggota"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Kotak Masuk Email
            </h2>
          </div>

          <div className="divide-y divide-slate-200">
            {myEmails.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Belum ada email notifikasi untuk akun Anda.
              </div>
            ) : (
              myEmails.map((em) => (
                <article key={em.id} className="p-5 space-y-2 hover:bg-slate-50/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {em.type === 'belum_dikembalikan' ? (
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                      ) : (
                        <Mail className="w-4 h-4 text-amber-600" />
                      )}
                      <h3 className="text-sm font-semibold text-slate-900">
                        {em.subject}
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(em.sentAt).toLocaleString('id-ID', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    Kepada: {em.recipientEmail} · Kode Barang: {em.itemQrCode}
                  </p>
                  <pre className="mt-2 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-sans text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {em.body}
                  </pre>
                </article>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
};
