import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailNotification,
  InventoryItem,
  LoanRecord,
  User,
} from '../types/inventory';
import {
  calculateDueState,
  handleDriveImageError,
  normalizeGoogleDriveImageUrl,
  validateBorrowRequest,
} from '../utils/inventoryLogic';
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
  RefreshCw,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
  X,
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
    loanIds?: string[];
    returnNotes: string;
    returnPhotoDataUrl: string;
  }) => void;
  onCancelLoans: (loanIds: string[]) => void;
  onMarkEmailsRead: (userId: string) => void;
}

/**
 * Compresses & resizes an uploaded or captured photo file via HTML5 Canvas
 * so high-resolution phone photos (5MB–15MB) become crisp ~80KB JPEG data URLs
 * that save and display reliably in MySQL and localStorage.
 */
function compressPhotoFile(
  file: File,
  maxDimension = 960,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
    reader.onload = (evt) => {
      const rawDataUrl = String(evt.target?.result || '');
      if (!rawDataUrl.startsWith('data:image/')) {
        reject(new Error('Format file bukan gambar/foto yang valid.'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
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
  onCancelLoans,
  onMarkEmailsRead,
}) => {
  // Borrow form state (Scan QR -> Adjust Quantity -> Confirm Loan)
  const [scannedQrCode, setScannedQrCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [borrowCart, setBorrowCart] = useState<
    Array<{ itemId: string; quantity: number }>
  >([]);
  const [durationDays, setDurationDays] = useState(3);
  const [dueDateInput, setDueDateInput] = useState(() => {
    const dt = new Date(new Date(referenceTimeIso).getTime() + 3 * 86400 * 1000);
    return dt.toISOString().slice(0, 10);
  });
  const [purposeNotes, setPurposeNotes] = useState('');
  const [borrowPhotoDataUrl, setBorrowPhotoDataUrl] = useState('');
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [borrowSuccess, setBorrowSuccess] = useState<string | null>(null);
  const [catalogFeedback, setCatalogFeedback] = useState<string | null>(null);

  // QR Scanner Camera state
  const [cameraTarget, setCameraTarget] = useState<'borrow' | 'return' | null>(
    null
  );
  const [cameraStatusMsg, setCameraStatusMsg] = useState<string | null>(null);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live WebRTC Photo Proof Camera state (for taking real Borrow / Return photos)
  const [photoCameraTarget, setPhotoCameraTarget] = useState<
    'borrow' | 'return' | null
  >(null);
  const [photoCameraFacing, setPhotoCameraFacing] = useState<
    'environment' | 'user'
  >('environment');
  const [photoCameraError, setPhotoCameraError] = useState<string | null>(null);
  const photoVideoRef = useRef<HTMLVideoElement | null>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);

  // File input refs for reliable photo uploading & native camera fallback
  const borrowFileInputRef = useRef<HTMLInputElement | null>(null);
  const borrowNativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const returnFileInputRef = useRef<HTMLInputElement | null>(null);
  const returnNativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  // Active Loans multi-selection in My Loans & Return tabs
  const [selectedMyLoanIds, setSelectedMyLoanIds] = useState<string[]>([]);

  // Return form state (supports single or multi-loan return)
  const [selectedReturnLoanIds, setSelectedReturnLoanIds] = useState<string[]>(
    []
  );
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
    if (!clean) return undefined;
    return items.find((i) => i.qrCode.toLowerCase() === clean);
  }, [items, scannedQrCode]);

  const resolvedCartEntries = useMemo(() => {
    return borrowCart
      .map((entry) => {
        const item = items.find((i) => i.id === entry.itemId);
        if (!item || item.availableStock <= 0) return null;
        return {
          item,
          quantity: Math.max(1, Math.min(item.availableStock, entry.quantity)),
        };
      })
      .filter(
        (x): x is { item: InventoryItem; quantity: number } => x !== null
      );
  }, [borrowCart, items]);

  const totalUnitsInCart = useMemo(
    () => resolvedCartEntries.reduce((sum, e) => sum + e.quantity, 0),
    [resolvedCartEntries]
  );

  const handleAddToBorrowCart = useCallback(
    (item: InventoryItem, addQty = 1) => {
      if (item.availableStock <= 0) {
        setBorrowError(
          `Barang "${item.name}" (${item.qrCode}) sedang habis / tidak tersedia.`
        );
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

  // Active loans selected for return
  const activeReturnLoansList = useMemo(() => {
    if (selectedReturnLoanIds.length > 0) {
      const found = myActiveLoans.filter((l) =>
        selectedReturnLoanIds.includes(l.id)
      );
      if (found.length > 0) return found;
    }
    if (returnQrInput.trim()) {
      const matched = myActiveLoans.filter(
        (l) =>
          l.itemQrCode.toLowerCase() === returnQrInput.trim().toLowerCase()
      );
      if (matched.length > 0) return matched;
    }
    return myActiveLoans.length > 0 ? [myActiveLoans[0]] : [];
  }, [myActiveLoans, selectedReturnLoanIds, returnQrInput]);

  const handleCancelSingleLoan = (loan: LoanRecord) => {
    onCancelLoans([loan.id]);
    setSelectedMyLoanIds((prev) => prev.filter((id) => id !== loan.id));
    setSelectedReturnLoanIds((prev) => prev.filter((id) => id !== loan.id));
    setCatalogFeedback(
      `Peminjaman "${loan.itemName}" (${loan.quantity} unit) berhasil dibatalkan/dihapus dan stok dikembalikan.`
    );
    setReturnSuccess(
      `Peminjaman "${loan.itemName}" (${loan.quantity} unit) berhasil dibatalkan/dihapus.`
    );
    setTimeout(() => {
      setCatalogFeedback(null);
      setReturnSuccess(null);
    }, 4500);
  };

  const handleCancelSelectedMyLoans = () => {
    if (selectedMyLoanIds.length === 0) return;
    const count = selectedMyLoanIds.length;
    onCancelLoans(selectedMyLoanIds);
    setSelectedMyLoanIds([]);
    setCatalogFeedback(
      `${count} peminjaman berhasil dibatalkan/dihapus dan stok telah dikembalikan ke inventaris.`
    );
    setTimeout(() => setCatalogFeedback(null), 4500);
  };

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

  // Stop QR scanner camera
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

  // Stop Photo Proof live camera
  const handleStopPhotoCamera = useCallback(() => {
    if (photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
    }
    if (photoVideoRef.current) {
      photoVideoRef.current.srcObject = null;
    }
    setPhotoCameraTarget(null);
  }, []);

  // Start Live WebRTC Camera for taking Borrow / Return photo proof
  const handleStartPhotoCamera = useCallback(
    async (
      target: 'borrow' | 'return',
      facing: 'environment' | 'user' = photoCameraFacing
    ) => {
      setPhotoCameraError(null);
      if (target === 'borrow') setBorrowError(null);
      else setReturnError(null);

      handleStopCameraScan();
      handleStopPhotoCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // Fallback to native mobile camera input if WebRTC is unavailable
        if (target === 'borrow') {
          borrowNativeCameraInputRef.current?.click();
        } else {
          returnNativeCameraInputRef.current?.click();
        }
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facing },
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
        photoStreamRef.current = stream;
        setPhotoCameraFacing(facing);
        setPhotoCameraTarget(target);
      } catch {
        setPhotoCameraError(
          'Kamera langsung tidak dapat diakses di browser ini. Membuka kamera/galeri perangkat...'
        );
        if (target === 'borrow') {
          borrowNativeCameraInputRef.current?.click();
        } else {
          returnNativeCameraInputRef.current?.click();
        }
      }
    },
    [photoCameraFacing, handleStopCameraScan, handleStopPhotoCamera]
  );

  // Attach photo stream to <video> element when photoCameraTarget is active
  useEffect(() => {
    if (!photoCameraTarget || !photoStreamRef.current) return;
    const videoEl = photoVideoRef.current;
    if (!videoEl) return;

    videoEl.srcObject = photoStreamRef.current;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.play().catch(() => {});
  }, [photoCameraTarget, photoCameraFacing]);

  // Capture real frame from Live Photo Camera
  const handleSnapPhotoFromLiveCamera = (target: 'borrow' | 'return') => {
    const v = photoVideoRef.current;
    if (!v || v.videoWidth === 0 || v.videoHeight === 0) {
      setPhotoCameraError(
        'Kamera sedang memuat gambar, tunggu 1 detik lalu tekan Jepret Foto kembali.'
      );
      return;
    }

    const maxDim = 960;
    let width = v.videoWidth;
    let height = v.videoHeight;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw live video frame
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    // Draw subtle bottom watermark bar with timestamp & user name
    const barHeight = 36;
    ctx.fillStyle = 'rgba(13, 17, 58, 0.75)';
    ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const modeLabel =
      target === 'borrow' ? 'BUKTI AMBIL BARANG' : 'BUKTI PENGEMBALIAN';
    const timeStr = new Date().toLocaleString('id-ID');
    ctx.fillText(
      `${modeLabel} · ${currentUser.name} · ${timeStr}`,
      12,
      canvas.height - 13
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    if (target === 'borrow') {
      setBorrowPhotoDataUrl(dataUrl);
      setBorrowError(null);
    } else {
      setReturnPhotoDataUrl(dataUrl);
      setReturnError(null);
    }

    handleStopPhotoCamera();
  };

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
        const foundItem = items.find(
          (i) => i.qrCode.toLowerCase() === code.toLowerCase()
        );
        if (foundItem) {
          if (foundItem.availableStock > 0) {
            handleAddToBorrowCart(foundItem, 1);
            setScannedQrCode('');
            setScanSuccessMsg(
              `Berhasil scan "${foundItem.name}" (${foundItem.qrCode}). Silakan atur jumlah unit di bawah!`
            );
          } else {
            setScannedQrCode(code);
            setBorrowError(
              `Barang "${foundItem.name}" (${foundItem.qrCode}) saat ini sedang habis dipinjam.`
            );
          }
        } else {
          setScannedQrCode(code);
          setBorrowError(
            `Kode QR "${code}" tidak ditemukan di dalam database inventaris.`
          );
        }
      } else {
        setReturnQrInput(code);
        const matchedLoan = myActiveLoans.find(
          (l) => l.itemQrCode.toLowerCase() === code.toLowerCase()
        );
        if (matchedLoan) {
          setSelectedReturnLoanIds((prev) =>
            prev.includes(matchedLoan.id) ? prev : [...prev, matchedLoan.id]
          );
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

      const Win = window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => {
          detect: (
            source: HTMLCanvasElement
          ) => Promise<Array<{ rawValue?: string }>>;
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

  useEffect(() => {
    if (!cameraTarget || !streamRef.current) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    videoEl.srcObject = streamRef.current;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.play().catch(() => {});

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

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (photoStreamRef.current) {
        photoStreamRef.current.getTracks().forEach((t) => t.stop());
        photoStreamRef.current = null;
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

    handleStopPhotoCamera();
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
      e.target.value = '';
    };
    img.src = objectUrl;
  };

  // Upload or native camera capture for Borrow Photo Proof
  const handleBorrowPhotoFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBorrowError(null);
    try {
      const compressedDataUrl = await compressPhotoFile(file);
      setBorrowPhotoDataUrl(compressedDataUrl);
      handleStopPhotoCamera();
    } catch (err) {
      setBorrowError(
        err instanceof Error
          ? err.message
          : 'Gagal memproses file foto bukti peminjaman.'
      );
    } finally {
      e.target.value = '';
    }
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
        'Silakan Scan Kode QR barang terlebih dahulu sebelum melakukan konfirmasi pinjaman.'
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
      `Peminjaman ${entriesToBorrow.length} jenis barang [${summaryNames}] berhasil dikonfirmasi & bukti dikirim ke email Anda!`
    );
    setBorrowCart([]);
    setScannedQrCode('');
    setPurposeNotes('');
    setBorrowPhotoDataUrl('');
    setQuantity(1);
  };

  // Upload or native camera capture for Return Photo Proof
  const handleReturnPhotoFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReturnError(null);
    try {
      const compressedDataUrl = await compressPhotoFile(file);
      setReturnPhotoDataUrl(compressedDataUrl);
      handleStopPhotoCamera();
    } catch (err) {
      setReturnError(
        err instanceof Error
          ? err.message
          : 'Gagal memproses file foto bukti pengembalian.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmitReturn = (e: React.FormEvent) => {
    e.preventDefault();
    setReturnError(null);
    setReturnSuccess(null);

    if (activeReturnLoansList.length === 0) {
      setReturnError('Pilih atau scan QR barang yang sedang Anda pinjam.');
      return;
    }
    if (!returnPhotoDataUrl) {
      setReturnError(
        'Bukti foto pengembalian barang wajib diambil/diunggah sebelum menyelesaikan pengembalian.'
      );
      return;
    }

    const idsToReturn = activeReturnLoansList.map((l) => l.id);

    onReturnItem({
      loanId: idsToReturn[0],
      loanIds: idsToReturn,
      returnNotes:
        returnNotes.trim() ||
        'Barang dikembalikan lengkap dalam kondisi berfungsi baik.',
      returnPhotoDataUrl,
    });

    const returnedNames = activeReturnLoansList
      .map((l) => `${l.itemName} (${l.itemQrCode})`)
      .join(', ');

    setReturnSuccess(
      `${activeReturnLoansList.length} pinjaman [${returnedNames}] telah berhasil dikembalikan ke inventaris.`
    );
    setReturnNotes('');
    setReturnPhotoDataUrl('');
    setReturnQrInput('');
    setSelectedReturnLoanIds([]);
  };

  const allMyActiveSelected =
    myActiveLoans.length > 0 &&
    myActiveLoans.every((l) => selectedMyLoanIds.includes(l.id));

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
                Anda memiliki barang pinjaman yang batas waktunya hampir habis atau belum dikembalikan. Periksa kotak masuk email Anda atau segera lakukan pengembalian.
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

      {/* TAB 1: MY ACTIVE LOANS (TANPA LIST SELURUH BARANG) */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          {catalogFeedback && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 text-xs font-medium text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{catalogFeedback}</span>
            </div>
          )}

          {/* Active Loans Summary */}
          <section
            aria-label="Peminjaman Aktif Saya"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Barang yang Kamu Pinjam ({myActiveLoans.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Untuk meminjam barang baru, gunakan tombol <strong>Scan QR untuk Pinjam Barang</strong>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedMyLoanIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReturnLoanIds(selectedMyLoanIds);
                        onChangeTab('return');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Kembalikan Terpilih ({selectedMyLoanIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelSelectedMyLoans}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Batal Pinjam Terpilih ({selectedMyLoanIds.length})
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onChangeTab('borrow')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg whitespace-nowrap shrink-0 shadow-xs"
                >
                  <ScanLine className="w-3.5 h-3.5 text-[#e71f69]" />
                  Scan QR untuk Pinjam Barang
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={allMyActiveSelected}
                        onChange={() => {
                          if (allMyActiveSelected) {
                            setSelectedMyLoanIds([]);
                          } else {
                            setSelectedMyLoanIds(myActiveLoans.map((l) => l.id));
                          }
                        }}
                        aria-label="Pilih semua pinjaman aktif saya"
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="py-3 px-4">Kode & Nama Barang</th>
                    <th className="py-3 px-4">Tanggal Pinjam · Jatuh Tempo</th>
                    <th className="py-3 px-4">Catatan Pemakaian</th>
                    <th className="py-3 px-4">Status Waktu</th>
                    <th className="py-3 px-4 text-right">Kembalikan / Batal Pinjam</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {myActiveLoans.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        <p className="font-medium text-slate-700">
                          Anda tidak memiliki peminjaman aktif saat ini.
                        </p>
                        <button
                          type="button"
                          onClick={() => onChangeTab('borrow')}
                          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg shadow-xs"
                        >
                          <ScanLine className="w-4 h-4 text-[#e71f69]" />
                          Mulai Scan QR Barang untuk Meminjam
                        </button>
                      </td>
                    </tr>
                  ) : (
                    myActiveLoans.map((loan) => {
                      const due = calculateDueState(loan, referenceTimeIso, 24);
                      const isChecked = selectedMyLoanIds.includes(loan.id);
                      return (
                        <tr
                          key={loan.id}
                          className={`hover:bg-slate-50/80 ${
                            isChecked ? 'bg-sky-50/50' : ''
                          }`}
                        >
                          <td className="py-3 px-4">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                setSelectedMyLoanIds((prev) =>
                                  prev.includes(loan.id)
                                    ? prev.filter((id) => id !== loan.id)
                                    : [...prev, loan.id]
                                )
                              }
                              aria-label={`Pilih pinjaman ${loan.itemName}`}
                              className="rounded border-slate-300"
                            />
                          </td>
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
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedReturnLoanIds([loan.id]);
                                  setReturnQrInput(loan.itemQrCode);
                                  onChangeTab('return');
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-md transition-colors shadow-xs"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Kembalikan
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelSingleLoan(loan)}
                                title="Batal pinjam / hapus pinjaman ini"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Batal Pinjam
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

      {/* TAB 2: BORROW ITEM (HANYA SCAN QR -> TAMBAH JUMLAH -> KONFIRMASI PINJAMAN) */}
      {activeTab === 'borrow' && (
        <section
          aria-label="Formulir Peminjaman Barang via Scan QR"
          className="bg-white border border-slate-200 rounded-lg p-6"
        >
          <div className="pb-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Scan Kode QR Barang & Konfirmasi Pinjaman
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Scan Kode QR pada barang yang ingin dipinjam, atur jumlah unit, ambil bukti foto pengambilan barang, lalu klik <strong>Konfirmasi Pinjaman</strong>.
              </p>
            </div>
            {resolvedCartEntries.length > 0 && (
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-[#0d113a] text-white">
                {resolvedCartEntries.length} Jenis Barang ({totalUnitsInCart} Unit) Siap Dipinjam
              </span>
            )}
          </div>

          <form
            onSubmit={handleSubmitBorrow}
            className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
            {/* Left Column: Only Scan QR & Adjust Quantity of Scanned Items */}
            <div className="lg:col-span-6 space-y-5">
              {/* Step 1: Scan QR Code */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <label
                  htmlFor="scan-qr-input"
                  className="block text-xs font-semibold text-slate-900"
                >
                  1. Scan Kode QR Barang
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      cameraTarget === 'borrow'
                        ? handleStopCameraScan()
                        : handleStartCameraScan('borrow')
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <ScanLine className="w-4 h-4 text-[#e71f69]" />
                    {cameraTarget === 'borrow'
                      ? 'Tutup Kamera QR'
                      : 'Buka Kamera Scan QR'}
                  </button>

                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                    <Camera className="w-4 h-4 text-[#e71f69]" />
                    Scan dari Foto QR
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleScanQrFromImageFile(e, 'borrow')}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    id="scan-qr-input"
                    type="text"
                    value={scannedQrCode}
                    onChange={(e) => {
                      setScannedQrCode(e.target.value);
                      setScanSuccessMsg(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && matchedItem) {
                        e.preventDefault();
                        handleAddToBorrowCart(matchedItem, 1);
                        setScannedQrCode('');
                      }
                    }}
                    placeholder="Atau gunakan alat scanner / ketik Kode QR..."
                    className="flex-1 min-w-[150px] px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                  />
                  {matchedItem && (
                    <button
                      type="button"
                      onClick={() => {
                        handleAddToBorrowCart(matchedItem, 1);
                        setScannedQrCode('');
                      }}
                      className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Tambah
                    </button>
                  )}
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
                        <div className="w-44 h-44 border-2 border-[#e71f69] rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-200">
                      Arahkan kamera ke Kode QR pada barang...
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

                {scannedQrCode.trim() !== '' && matchedItem && (
                  <div className="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {matchedItem.imageUrl ? (
                        <img
                          src={normalizeGoogleDriveImageUrl(matchedItem.imageUrl)}
                          alt={matchedItem.name}
                          referrerPolicy="no-referrer"
                          onError={(e) =>
                            handleDriveImageError(
                              e,
                              matchedItem.imageUrl,
                              matchedItem.name
                            )
                          }
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                        />
                      ) : (
                        <QrCodeSvg value={matchedItem.qrCode} size={48} />
                      )}
                      <div className="text-xs">
                        <span className="font-mono font-semibold text-[#e71f69]">
                          TERDETEKSI · {matchedItem.qrCode}
                        </span>
                        <p className="font-semibold text-slate-900">
                          {matchedItem.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Tersedia: {matchedItem.availableStock} unit
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleAddToBorrowCart(matchedItem, 1);
                        setScannedQrCode('');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Masukkan
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2: Scanned Items List + Quantity Adjustment */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">
                    2. Barang Hasil Scan QR & Atur Jumlah Unit ({resolvedCartEntries.length} Jenis · {totalUnitsInCart} Unit)
                  </span>
                  {resolvedCartEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBorrowCart([])}
                      className="text-[11px] font-medium text-red-600 hover:underline"
                    >
                      Kosongkan
                    </button>
                  )}
                </div>

                {resolvedCartEntries.length === 0 ? (
                  <div className="p-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center space-y-2">
                    <ScanLine className="w-7 h-7 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700">
                      Belum Ada Barang yang Di-Scan
                    </p>
                    <p className="text-xs text-slate-500">
                      Silakan klik <strong>Buka Kamera Scan QR</strong> di atas untuk memindai QR barang yang ingin dipinjam. Anda dapat memindai lebih dari 1 barang.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white">
                    {resolvedCartEntries.map(({ item, quantity: itemQty }) => {
                      const normalizedImg = item.imageUrl
                        ? normalizeGoogleDriveImageUrl(item.imageUrl)
                        : '';
                      return (
                        <div
                          key={item.id}
                          className="p-3.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {normalizedImg ? (
                              <img
                                src={normalizedImg}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                onError={(e) =>
                                  handleDriveImageError(
                                    e,
                                    item.imageUrl,
                                    item.name
                                  )
                                }
                                className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                              />
                            ) : (
                              <QrCodeSvg value={item.qrCode} size={40} />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 truncate">
                                {item.name}
                              </p>
                              <p className="font-mono text-[11px] text-slate-500 mt-0.5">
                                {item.qrCode} · Maks: {item.availableStock} unit
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateCartQuantity(item.id, itemQty - 1)
                              }
                              aria-label={`Kurangi jumlah ${item.name}`}
                              className="p-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100"
                            >
                              <Minus className="w-3.5 h-3.5" />
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
                              aria-label={`Jumlah unit ${item.name}`}
                              className="w-14 py-1 text-center text-xs font-mono font-semibold border border-slate-200 rounded-md bg-white"
                            />
                            <button
                              type="button"
                              disabled={itemQty >= item.availableStock}
                              onClick={() =>
                                handleUpdateCartQuantity(item.id, itemQty + 1)
                              }
                              aria-label={`Tambah jumlah ${item.name}`}
                              className="p-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveFromCart(item.id)}
                              aria-label={`Hapus ${item.name} dari daftar`}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md ml-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Duration, Notes, Real Camera / Photo Upload, and Confirm Loan */}
            <div className="lg:col-span-6 space-y-5">
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
                      handleDurationChange(
                        Number.parseInt(e.target.value, 10) || 1
                      )
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
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
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
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
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                />
              </div>

              {/* Real Camera & File Upload for Borrow Photo Proof */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="block text-xs font-semibold text-slate-800">
                    3. Bukti Foto Pengambilan Barang *
                  </span>
                  {borrowPhotoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setBorrowPhotoDataUrl('')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      <X className="w-3.5 h-3.5" />
                      Hapus / Ulangi Foto
                    </button>
                  )}
                </div>

                {/* Hidden File Inputs for Native Camera & Gallery Upload */}
                <input
                  ref={borrowNativeCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleBorrowPhotoFile}
                  className="hidden"
                />
                <input
                  ref={borrowFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBorrowPhotoFile}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      photoCameraTarget === 'borrow'
                        ? handleStopPhotoCamera()
                        : handleStartPhotoCamera('borrow', 'environment')
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg transition-colors shadow-xs"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {photoCameraTarget === 'borrow'
                      ? 'Tutup Kamera'
                      : 'Buka Kamera Ambil Foto'}
                  </button>

                  <button
                    type="button"
                    onClick={() => borrowFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#0d113a]" />
                    Unggah File Foto
                  </button>
                </div>

                {photoCameraError && photoCameraTarget === null && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    {photoCameraError}
                  </p>
                )}

                {/* Live WebRTC Photo Stream */}
                {photoCameraTarget === 'borrow' && (
                  <div className="p-3 bg-slate-900 rounded-xl space-y-3">
                    <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center">
                      <video
                        ref={photoVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSnapPhotoFromLiveCamera('borrow')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
                      >
                        <Camera className="w-4 h-4" />
                        Jepret Foto Bukti
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleStartPhotoCamera(
                            'borrow',
                            photoCameraFacing === 'environment'
                              ? 'user'
                              : 'environment'
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Putar Kamera
                      </button>
                      <button
                        type="button"
                        onClick={handleStopPhotoCamera}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {/* Captured or Uploaded Photo Preview */}
                {borrowPhotoDataUrl && (
                  <div className="space-y-1.5">
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-w-md bg-slate-900 aspect-video flex items-center justify-center">
                      <img
                        src={borrowPhotoDataUrl}
                        alt="Pratinjau bukti foto peminjaman"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <p className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Foto bukti pengambilan barang berhasil dilampirkan.
                    </p>
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

              <div className="pt-1">
                <button
                  type="submit"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
                >
                  <Package className="w-4 h-4 text-[#e71f69]" />
                  Konfirmasi Pinjaman
                  {resolvedCartEntries.length > 0
                    ? ` (${resolvedCartEntries.length} Barang · ${totalUnitsInCart} Unit)`
                    : ''}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* TAB 3: RETURN ITEM (SUPPORTS MULTI-RETURN, LIVE CAMERA PHOTO & UPLOAD) */}
      {activeTab === 'return' && (
        <section
          aria-label="Formulir Pengembalian Barang"
          className="bg-white border border-slate-200 rounded-lg p-6"
        >
          <div className="pb-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pengembalian atau Pembatalan Barang Pinjaman
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Centang atau Scan QR barang yang dikembalikan, ambil/unggah foto bukti pengembalian, lalu selesaikan pengembalian
              </p>
            </div>
          </div>

          {returnSuccess && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{returnSuccess}</span>
            </div>
          )}

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
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    1. Pilih Barang yang Dikembalikan ({activeReturnLoansList.length} Dipilih)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedReturnLoanIds.length === myActiveLoans.length) {
                        setSelectedReturnLoanIds([]);
                      } else {
                        setSelectedReturnLoanIds(myActiveLoans.map((l) => l.id));
                      }
                    }}
                    className="text-xs font-medium text-sky-700 hover:underline"
                  >
                    {selectedReturnLoanIds.length === myActiveLoans.length
                      ? 'Batal Pilih Semua'
                      : 'Pilih Semua Pinjaman'}
                  </button>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  {myActiveLoans.map((l) => {
                    const isSelected = activeReturnLoansList.some(
                      (item) => item.id === l.id
                    );
                    return (
                      <div
                        key={l.id}
                        onClick={() =>
                          setSelectedReturnLoanIds((prev) =>
                            prev.includes(l.id)
                              ? prev.filter((id) => id !== l.id)
                              : [...prev, l.id]
                          )
                        }
                        className={`p-3 flex items-center justify-between gap-2 cursor-pointer text-xs ${
                          isSelected ? 'bg-sky-50/70' : 'bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-slate-300 pointer-events-none"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">
                              {l.itemName} ({l.quantity} unit)
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {l.itemQrCode} · Batas:{' '}
                              {new Date(l.dueDate).toLocaleDateString('id-ID')}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelSingleLoan(l);
                          }}
                          title="Batal pinjam / hapus pinjaman ini"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                          Batal Pinjam
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <label
                    htmlFor="return-qr-verify"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Atau Scan Kode QR Barang yang Dikembalikan
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="return-qr-verify"
                      type="text"
                      value={returnQrInput}
                      onChange={(e) => setReturnQrInput(e.target.value)}
                      placeholder="Scan Kode QR..."
                      className="flex-1 min-w-[150px] px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
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
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                  />
                </div>

                {/* Real Camera & File Upload for Return Photo Proof */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-semibold text-slate-800">
                      Bukti Foto Barang Saat Dikembalikan *
                    </span>
                    {returnPhotoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setReturnPhotoDataUrl('')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        <X className="w-3.5 h-3.5" />
                        Hapus / Ulangi Foto
                      </button>
                    )}
                  </div>

                  {/* Hidden File Inputs for Native Camera & Gallery Upload */}
                  <input
                    ref={returnNativeCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleReturnPhotoFile}
                    className="hidden"
                  />
                  <input
                    ref={returnFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleReturnPhotoFile}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        photoCameraTarget === 'return'
                          ? handleStopPhotoCamera()
                          : handleStartPhotoCamera('return', 'environment')
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {photoCameraTarget === 'return'
                        ? 'Tutup Kamera'
                        : 'Buka Kamera Ambil Foto'}
                    </button>

                    <button
                      type="button"
                      onClick={() => returnFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#0d113a]" />
                      Unggah File Foto Pengembalian
                    </button>
                  </div>

                  {/* Live WebRTC Photo Stream for Return */}
                  {photoCameraTarget === 'return' && (
                    <div className="p-3 bg-slate-900 rounded-xl space-y-3">
                      <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center">
                        <video
                          ref={photoVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSnapPhotoFromLiveCamera('return')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs"
                        >
                          <Camera className="w-4 h-4" />
                          Jepret Foto Bukti
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleStartPhotoCamera(
                              'return',
                              photoCameraFacing === 'environment'
                                ? 'user'
                                : 'environment'
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Putar Kamera
                        </button>
                        <button
                          type="button"
                          onClick={handleStopPhotoCamera}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Captured or Uploaded Return Photo Preview */}
                  {returnPhotoDataUrl && (
                    <div className="space-y-1.5">
                      <div className="border border-slate-200 rounded-lg overflow-hidden max-w-md bg-slate-900 aspect-video flex items-center justify-center">
                        <img
                          src={returnPhotoDataUrl}
                          alt="Pratinjau bukti foto pengembalian"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <p className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Foto bukti pengembalian barang berhasil dilampirkan.
                      </p>
                    </div>
                  )}
                </div>

                {returnError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-600">
                    {returnError}
                  </div>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Selesaikan Pengembalian ({activeReturnLoansList.length} Barang)
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
              Kotak Masuk & Riwayat Email ({currentUser.email})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Seluruh pesan di bawah ini juga dikirimkan secara otomatis ke alamat email/Gmail Anda ({currentUser.email})
            </p>
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
