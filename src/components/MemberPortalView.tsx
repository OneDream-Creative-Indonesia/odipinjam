import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Minus,
  Package,
  Plus,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  Trash2,
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
    entries?: Array<{ item: InventoryItem; quantity: number }>;
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
  // Borrow form state (starts empty so nothing is randomly detected before scanning)
  const [scannedQrCode, setScannedQrCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [borrowCart, setBorrowCart] = useState<
    Array<{ itemId: string; quantity: number }>
  >([]);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [durationDays, setDurationDays] = useState(3);
  const [dueDateInput, setDueDateInput] = useState(() => {
    const dt = new Date(new Date(referenceTimeIso).getTime() + 3 * 86400 * 1000);
    return dt.toISOString().slice(0, 10);
  });
  const [purposeNotes, setPurposeNotes] = useState('');
  const [borrowPhotoDataUrl, setBorrowPhotoDataUrl] = useState('');
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [borrowSuccess, setBorrowSuccess] = useState<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<'borrow' | 'return' | null>(null);
  const [cameraStatusMsg, setCameraStatusMsg] = useState<string | null>(null);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  const availableItems = useMemo(
    () => items.filter((i) => i.availableStock > 0),
    [items]
  );

  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.qrCode.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q)
    );
  }, [items, catalogSearch]);

  const resolvedCartEntries = useMemo(() => {
    return borrowCart
      .map((entry) => {
        const item = items.find((i) => i.id === entry.itemId);
        if (!item) return null;
        return {
          item,
          quantity: Math.max(1, Math.min(item.availableStock || 1, entry.quantity)),
        };
      })
      .filter((x): x is { item: InventoryItem; quantity: number } => x !== null);
  }, [borrowCart, items]);

  const handleAddToBorrowCart = useCallback(
    (item: InventoryItem, addQty = 1) => {
      if (item.availableStock <= 0) {
        setBorrowError(`Barang "${item.name}" sedang tidak tersedia untuk dipinjam.`);
        return;
      }
      setBorrowError(null);
      setBorrowSuccess(null);
      setBorrowCart((prev) => {
        const existing = prev.find((e) => e.itemId === item.id);
        if (existing) {
          const nextQty = Math.min(
            item.availableStock,
            existing.quantity + Math.max(1, addQty)
          );
          return prev.map((e) =>
            e.itemId === item.id ? { ...e, quantity: nextQty } : e
          );
        }
        return [
          ...prev,
          {
            itemId: item.id,
            quantity: Math.min(item.availableStock, Math.max(1, addQty)),
          },
        ];
      });
    },
    []
  );

  const handleUpdateCartQuantity = (itemId: string, nextQty: number) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (nextQty <= 0) {
      setBorrowCart((prev) => prev.filter((e) => e.itemId !== itemId));
      return;
    }
    const clamped = Math.max(1, Math.min(item.availableStock, nextQty));
    setBorrowCart((prev) =>
      prev.map((e) => (e.itemId === itemId ? { ...e, quantity: clamped } : e))
    );
  };

  const handleRemoveFromCart = (itemId: string) => {
    setBorrowCart((prev) => prev.filter((e) => e.itemId !== itemId));
  };

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

  const handleStopCameraScan = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraTarget(null);
  }, []);

  const applyDecodedQrResult = useCallback(
    (rawValue: string, target: 'borrow' | 'return') => {
      const code = rawValue.trim().toUpperCase();
      if (!code) return;
      try {
        navigator.vibrate?.(100);
      } catch {
        // ignore
      }
      if (target === 'borrow') {
        setScannedQrCode(code);
        const foundItem = items.find(
          (i) => i.qrCode.toLowerCase() === code.toLowerCase()
        );
        if (foundItem && foundItem.availableStock > 0) {
          handleAddToBorrowCart(foundItem, 1);
          setScanSuccessMsg(
            `Berhasil memindai "${foundItem.name}" (${code}) & ditambahkan ke daftar pinjam!`
          );
        } else {
          setScanSuccessMsg(`Berhasil memindai Kode QR: ${code}`);
        }
      } else {
        setReturnQrInput(code);
        const matchedLoan = myActiveLoans.find(
          (l) => l.itemQrCode.toLowerCase() === code.toLowerCase()
        );
        if (matchedLoan) {
          setSelectedReturnLoanId(matchedLoan.id);
        }
        setScanSuccessMsg(`Berhasil memindai Kode QR: ${code}`);
      }
      setCameraStatusMsg(null);
      handleStopCameraScan();
    },
    [handleStopCameraScan, myActiveLoans, items, handleAddToBorrowCart]
  );

  const decodeQrFromCanvas = useCallback(
    async (canvas: HTMLCanvasElement): Promise<string | null> => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || canvas.width === 0 || canvas.height === 0) return null;

      // 1. Try native BarcodeDetector if available (Android Chrome / Edge / WebView)
      const Win = window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => {
          detect: (source: HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>>;
        };
        jsQR?: (
          data: Uint8ClampedArray,
          width: number,
          height: number,
          options?: { inversionAttempts?: string }
        ) => { data?: string } | null;
      };

      if (typeof Win.BarcodeDetector === 'function') {
        try {
          const detector = new Win.BarcodeDetector({
            formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'],
          });
          const barcodes = await detector.detect(canvas);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            return barcodes[0].rawValue.trim();
          }
        } catch {
          // fallback to jsQR
        }
      }

      // 2. Try jsQR (works across iOS Safari, Firefox, Chrome, etc.)
      if (typeof Win.jsQR === 'function') {
        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = Win.jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (qr && qr.data && qr.data.trim()) {
            return qr.data.trim();
          }
        } catch {
          // ignore
        }
      }

      return null;
    },
    []
  );

  // Attach MediaStream after <video> mounts and run continuous QR/barcode detection
  useEffect(() => {
    if (!cameraTarget || !streamRef.current) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    videoEl.srcObject = streamRef.current;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.play().catch(() => {
      // autoplay handled
    });

    const offscreen = document.createElement('canvas');
    let isCancelled = false;

    const intervalId = window.setInterval(async () => {
      if (isCancelled || !videoRef.current) return;
      const v = videoRef.current;
      if (v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) return;

      offscreen.width = v.videoWidth;
      offscreen.height = v.videoHeight;
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, offscreen.width, offscreen.height);

      const detected = await decodeQrFromCanvas(offscreen);
      if (!isCancelled && detected) {
        applyDecodedQrResult(detected, cameraTarget);
      }
    }, 220);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [cameraTarget, decodeQrFromCanvas, applyDecodedQrResult]);

  // Stop camera when switching tabs or unmounting
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [activeTab]);

  const handleStartCameraScan = async (target: 'borrow' | 'return') => {
    setCameraStatusMsg(null);
    setScanSuccessMsg(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatusMsg(
        'Browser ini tidak mengizinkan akses kamera langsung. Gunakan tombol "Foto QR" di sebelahnya untuk memindai lewat kamera HP.'
      );
      return;
    }

    handleStopCameraScan();

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      streamRef.current = stream;
      setCameraTarget(target);
    } catch {
      setCameraStatusMsg(
        'Izin kamera ditolak atau tidak tersedia. Pastikan izin kamera diaktifkan di browser HP Anda, atau gunakan tombol "Foto QR".'
      );
    }
  };

  const handleScanQrFromImageFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'borrow' | 'return'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraStatusMsg(null);
    setScanSuccessMsg(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const decoded = await decodeQrFromCanvas(canvas);
        if (decoded) {
          applyDecodedQrResult(decoded, target);
        } else {
          setCameraStatusMsg(
            'Kode QR tidak terbaca dari foto tersebut. Pastikan foto Kode QR terlihat jelas dan terang.'
          );
        }
      }
      URL.revokeObjectURL(objectUrl);
      e.target.value = '';
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setCameraStatusMsg('Gagal memuat gambar Kode QR.');
    };
    img.src = objectUrl;
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
    const targetItem = resolvedCartEntries[0]?.item || matchedItem;
    if (!targetItem) {
      setBorrowError(
        'Silakan tambahkan atau scan barang terlebih dahulu sebelum mengambil bukti foto.'
      );
      return;
    }
    const titleLabel =
      resolvedCartEntries.length > 1
        ? `${targetItem.name} (+${resolvedCartEntries.length - 1} barang lainnya)`
        : targetItem.name;
    const svgUrl = createEquipmentPhotoProofSvg({
      title: titleLabel,
      qrCode: targetItem.qrCode,
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

    const entriesToBorrow: Array<{ item: InventoryItem; quantity: number }> =
      resolvedCartEntries.length > 0
        ? resolvedCartEntries
        : matchedItem
          ? [{ item: matchedItem, quantity }]
          : [];

    if (entriesToBorrow.length === 0) {
      setBorrowError(
        'Silakan tambahkan minimal 1 barang yang akan dipinjam (melalui Scan QR atau Pilih Barang).'
      );
      return;
    }

    for (const entry of entriesToBorrow) {
      const validation = validateBorrowRequest({
        item: entry.item,
        quantity: entry.quantity,
        borrowDate: nowIso,
        dueDate: dueIso,
        purposeNotes,
        borrowPhotoDataUrl,
      });

      if (!validation.valid) {
        setBorrowError(
          validation.error ||
            `Data peminjaman untuk "${entry.item.name}" belum lengkap.`
        );
        return;
      }
    }

    onBorrowItem({
      item: entriesToBorrow[0].item,
      quantity: entriesToBorrow[0].quantity,
      entries: entriesToBorrow,
      borrowDate: nowIso,
      dueDate: dueIso,
      durationDays,
      purposeNotes: purposeNotes.trim(),
      borrowPhotoDataUrl,
    });

    const summaryNames = entriesToBorrow
      .map((e) => `${e.item.name} (${e.quantity} unit)`)
      .join(', ');

    setBorrowSuccess(
      `Peminjaman ${entriesToBorrow.length} jenis barang [${summaryNames}] berhasil dicatat!`
    );
    setBorrowCart([]);
    setScannedQrCode('');
    setSelectedCatalogItemId('');
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

          {/* Available Inventory Catalog for Members */}
          <section
            aria-label="Katalog Barang Tersedia"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Pilih & Tambah Barang yang Akan Dipinjam ({availableItems.length} Tersedia)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Klik tombol <strong>+ Tambah Pinjam</strong> pada barang untuk memasukkannya ke daftar peminjaman Anda.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Cari nama / kode barang..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                  />
                </div>
                {resolvedCartEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChangeTab('borrow')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <Package className="w-3.5 h-3.5" />
                    Lanjut Pinjam ({resolvedCartEntries.length})
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Nama & Kode Barang</th>
                    <th className="py-3 px-4">Kategori · Lokasi</th>
                    <th className="py-3 px-4">Stok Tersedia</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredCatalogItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        Tidak ada barang yang cocok dengan pencarian.
                      </td>
                    </tr>
                  ) : (
                    filteredCatalogItems.map((item) => {
                      const inCart = borrowCart.find((c) => c.itemId === item.id);
                      const isAvailable = item.availableStock > 0;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">
                              {item.name}
                            </p>
                            <p className="font-mono text-slate-500 mt-0.5 tabular-nums">
                              {item.qrCode}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {item.category} · {item.location}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {isAvailable ? (
                              <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-700">
                                {item.availableStock} / {item.totalStock} unit
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                Habis / Tidak Tersedia
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              {inCart && (
                                <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-[#0d113a]/10 text-[#0d113a]">
                                  Di Daftar: {inCart.quantity} unit
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={!isAvailable}
                                onClick={() => {
                                  handleAddToBorrowCart(item, 1);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] disabled:bg-slate-200 disabled:text-slate-400 rounded-md transition-colors shadow-xs"
                              >
                                <Plus className="w-3.5 h-3.5 text-[#e71f69]" />
                                Tambah Pinjam
                              </button>
                            </div>
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

      {/* TAB 2: BORROW ITEM (SCAN QR + ADD MULTIPLE ITEMS + DURATION + NOTES + PHOTO PROOF) */}
      {activeTab === 'borrow' && (
        <section
          aria-label="Formulir Peminjaman Barang dengan Scan QR dan Bukti Foto"
          className="bg-white border border-slate-200 rounded-lg p-6"
        >
          <div className="pb-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pinjam Barang
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Anda dapat memindai Kode QR atau memilih beberapa barang sekaligus ke dalam daftar pinjaman.
              </p>
            </div>
            {resolvedCartEntries.length > 0 && (
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-[#0d113a] text-white">
                {resolvedCartEntries.length} Jenis Barang Dipilih
              </span>
            )}
          </div>

          <form
            onSubmit={handleSubmitBorrow}
            className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            {/* Left Column: QR Scanner & Item Selection */}
            <div className="lg:col-span-5 space-y-5">
              {/* Method A: Scan QR Code */}
              <div>
                <label
                  htmlFor="scan-qr-input"
                  className="block text-xs font-semibold text-slate-800 mb-1.5"
                >
                  1. Scan atau Ketik Kode QR Barang
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="scan-qr-input"
                    type="text"
                    value={scannedQrCode}
                    onChange={(e) => {
                      setScannedQrCode(e.target.value);
                      setScanSuccessMsg(null);
                    }}
                    placeholder="Scan atau ketik Kode QR..."
                    className="flex-1 min-w-[150px] px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      cameraTarget === 'borrow'
                        ? handleStopCameraScan()
                        : handleStartCameraScan('borrow')
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <ScanLine className="w-3.5 h-3.5 text-[#e71f69]" />
                    {cameraTarget === 'borrow' ? 'Tutup Kamera' : 'Kamera QR'}
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                    <Camera className="w-3.5 h-3.5 text-[#e71f69]" />
                    Foto QR
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleScanQrFromImageFile(e, 'borrow')}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              {cameraTarget === 'borrow' && (
                <div className="p-3 bg-slate-900 rounded-lg text-center space-y-2 relative overflow-hidden">
                  <div className="relative rounded overflow-hidden border border-slate-700 bg-black">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-56 object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-40 h-40 border-2 border-[#e71f69] rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-200">
                    Arahkan kamera ke Kode QR / Barcode pada barang...
                  </p>
                </div>
              )}

              {scanSuccessMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{scanSuccessMsg}</span>
                </div>
              )}

              {cameraStatusMsg && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  {cameraStatusMsg}
                </p>
              )}

              {/* Matched Item Card from QR */}
              {scannedQrCode.trim() !== '' && (
                matchedItem ? (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <QrCodeSvg value={matchedItem.qrCode} size={56} />
                      <div className="text-xs space-y-0.5">
                        <span className="font-mono font-semibold text-[#e71f69]">
                          TERDETEKSI · {matchedItem.qrCode}
                        </span>
                        <p className="font-semibold text-slate-900 text-sm">
                          {matchedItem.name}
                        </p>
                        <p className="text-slate-500">
                          Tersedia:{' '}
                          <strong className="font-mono text-slate-900">
                            {matchedItem.availableStock} unit
                          </strong>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleAddToBorrowCart(matchedItem, 1);
                        setScannedQrCode('');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg shrink-0 shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Tambah
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    Kode QR <span className="font-mono font-semibold">"{scannedQrCode}"</span> tidak ditemukan dalam inventaris.
                  </div>
                )
              )}

              {/* Method B: Add Item Directly from Available Inventory Dropdown */}
              <div className="pt-2 border-t border-slate-200">
                <label
                  htmlFor="select-borrow-item"
                  className="block text-xs font-semibold text-slate-800 mb-1.5"
                >
                  2. Atau Pilih & Tambah dari Daftar Barang Tersedia
                </label>
                <div className="flex gap-2">
                  <select
                    id="select-borrow-item"
                    value={selectedCatalogItemId}
                    onChange={(e) => setSelectedCatalogItemId(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                  >
                    <option value="">-- Pilih Barang yang Akan Dipinjam --</option>
                    {availableItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.qrCode}) — Tersedia: {item.availableStock} unit
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const target = availableItems.find(
                        (i) => i.id === selectedCatalogItemId
                      );
                      if (target) {
                        handleAddToBorrowCart(target, 1);
                        setSelectedCatalogItemId('');
                      } else {
                        setBorrowError(
                          'Pilih barang terlebih dahulu dari daftar sebelum menekan tombol + Tambah Barang.'
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah Barang
                  </button>
                </div>
              </div>

              {/* List of Added Items to Borrow (Cart) */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Daftar Barang yang Akan Dipinjam ({resolvedCartEntries.length})
                  </span>
                  {resolvedCartEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBorrowCart([])}
                      className="text-[11px] font-medium text-red-600 hover:underline"
                    >
                      Kosongkan Daftar
                    </button>
                  )}
                </div>

                {resolvedCartEntries.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 flex items-start gap-2.5">
                    <QrCode className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      Belum ada barang di daftar pinjam. Scan Kode QR dengan{' '}
                      <strong className="text-slate-900">Kamera QR</strong> atau pilih barang pada dropdown di atas lalu klik{' '}
                      <strong className="text-slate-900">+ Tambah Barang</strong>.
                    </span>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-slate-50/60">
                    {resolvedCartEntries.map(({ item, quantity: itemQty }) => (
                      <div
                        key={item.id}
                        className="p-3 flex items-center justify-between gap-3 bg-white hover:bg-slate-50/80"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {item.name}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {item.qrCode} · Maks {item.availableStock} unit
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateCartQuantity(item.id, itemQty - 1)
                            }
                            aria-label={`Kurangi jumlah ${item.name}`}
                            className="p-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={item.availableStock}
                            value={itemQty}
                            onChange={(e) =>
                              handleUpdateCartQuantity(
                                item.id,
                                Number.parseInt(e.target.value, 10) || 1
                              )
                            }
                            className="w-12 py-1 text-center text-xs font-mono border border-slate-200 rounded bg-white text-slate-900"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateCartQuantity(item.id, itemQty + 1)
                            }
                            disabled={itemQty >= item.availableStock}
                            aria-label={`Tambah jumlah ${item.name}`}
                            className="p-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 text-slate-700"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.id)}
                            aria-label={`Hapus ${item.name} dari daftar`}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded ml-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Duration, Notes, and Photo Proof */}
            <div className="lg:col-span-7 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  {resolvedCartEntries.length > 0
                    ? ` (${resolvedCartEntries.length} Barang)`
                    : ''}
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
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="return-qr-verify"
                      type="text"
                      value={returnQrInput || activeReturnLoan?.itemQrCode || ''}
                      onChange={(e) => setReturnQrInput(e.target.value)}
                      placeholder="Scan Kode QR untuk verifikasi..."
                      className="flex-1 min-w-[150px] px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        cameraTarget === 'return'
                          ? handleStopCameraScan()
                          : handleStartCameraScan('return')
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
                    >
                      <ScanLine className="w-3.5 h-3.5 text-[#e71f69]" />
                      {cameraTarget === 'return' ? 'Tutup Kamera' : 'Kamera QR'}
                    </button>
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                      <Camera className="w-3.5 h-3.5 text-[#e71f69]" />
                      Foto QR
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleScanQrFromImageFile(e, 'return')}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                {cameraTarget === 'return' && (
                  <div className="p-3 bg-slate-900 rounded-lg text-center space-y-2 relative overflow-hidden">
                    <div className="relative rounded overflow-hidden border border-slate-700 bg-black">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-56 object-cover"
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="w-40 h-40 border-2 border-[#e71f69] rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-200">
                      Arahkan kamera ke Kode QR barang yang dikembalikan...
                    </p>
                  </div>
                )}

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
