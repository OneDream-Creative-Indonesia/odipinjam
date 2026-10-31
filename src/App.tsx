/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailNotification,
  InventoryItem,
  LoanRecord,
  User,
} from './types/inventory';
import {
  INITIAL_ITEMS,
  INITIAL_USERS,
  createInitialLoans,
} from './data/seedData';
import {
  authenticateUser,
  buildAutomatedEmailNotifications,
  calculateDueState,
} from './utils/inventoryLogic';
import { AdminDashboardView } from './components/AdminDashboardView';
import { AdminInventoryView } from './components/AdminInventoryView';
import { AdminUsersView } from './components/AdminUsersView';
import { AdminLoansAndEmailsView } from './components/AdminLoansAndEmailsView';
import { MemberPortalView } from './components/MemberPortalView';
import { QrLabelModal } from './components/QrCodeSvg';
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Mail,
  Package,
  QrCode,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';

const STORAGE_KEYS = {
  USERS: 'sipinjam_prod_users_v2',
  ITEMS: 'sipinjam_prod_items_v2',
  LOANS: 'sipinjam_prod_loans_v2',
  EMAILS: 'sipinjam_prod_emails_v2',
  SESSION_USER_ID: 'sipinjam_prod_session_uid_v2',
};

const LEGACY_DEMO_KEYS = [
  'sipinjam_users_v1',
  'sipinjam_items_v1',
  'sipinjam_loans_v1',
  'sipinjam_emails_v1',
  'sipinjam_session_uid_v1',
];

export default function App() {
  const [referenceTimeIso] = useState<string>(() => new Date().toISOString());

  // Purge any legacy v1 demo localStorage keys on boot
  useEffect(() => {
    try {
      for (const k of LEGACY_DEMO_KEYS) {
        localStorage.removeItem(k);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // Persistent state initialization
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.USERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((u: User) =>
            u.id === 'usr-admin-master'
              ? { ...u, email: INITIAL_USERS[0].email, password: INITIAL_USERS[0].password }
              : u
          );
        }
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_USERS;
  });

  const [items, setItems] = useState<InventoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ITEMS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return INITIAL_ITEMS;
  });

  const [loans, setLoans] = useState<LoanRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LOANS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return createInitialLoans(new Date().toISOString());
  });

  const [emails, setEmails] = useState<EmailNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EMAILS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return [];
  });

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    try {
      const savedUid = localStorage.getItem(STORAGE_KEYS.SESSION_USER_ID);
      if (savedUid) return savedUid;
    } catch {
      // ignore
    }
    return null;
  });

  // Login form state (clean, no pre-filled dummy credentials)
  const [loginRoleTab, setLoginRoleTab] = useState<'admin' | 'anggota'>('admin');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Navigation state
  const [adminTab, setAdminTab] = useState<
    'dashboard' | 'inventory' | 'loans' | 'users' | 'emails'
  >('dashboard');
  const [memberTab, setMemberTab] = useState<
    'catalog' | 'borrow' | 'return' | 'notifications'
  >('catalog');

  // QR Inspection Modal state
  const [inspectedQrItem, setInspectedQrItem] =
    useState<InventoryItem | null>(null);

  const latestStateRef = useRef({ users, items, loans, emails });
  useEffect(() => {
    latestStateRef.current = { users, items, loans, emails };
  }, [users, items, loans, emails]);

  const pushStateToServer = useCallback(
    async (partial: {
      users?: User[];
      items?: InventoryItem[];
      loans?: LoanRecord[];
      emails?: EmailNotification[];
    }) => {
      const payload = {
        users: partial.users ?? latestStateRef.current.users,
        items: partial.items ?? latestStateRef.current.items,
        loans: partial.loans ?? latestStateRef.current.loans,
        emails: partial.emails ?? latestStateRef.current.emails,
      };
      latestStateRef.current = payload;
      try {
        await fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Fallback to localStorage when running without backend API
      }
    },
    []
  );

  const pullStateFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const serverUsers: User[] = Array.isArray(data.users) ? data.users : [];
      const serverItems: InventoryItem[] = Array.isArray(data.items)
        ? data.items
        : [];
      const serverLoans: LoanRecord[] = Array.isArray(data.loans)
        ? data.loans
        : [];
      const serverEmails: EmailNotification[] = Array.isArray(data.emails)
        ? data.emails
        : [];

      const serverIsEmpty =
        !data.initialized ||
        (serverUsers.length <= 1 &&
          serverItems.length === 0 &&
          serverLoans.length === 0);

      const local = latestStateRef.current;
      const localHasData =
        local.users.length > 1 ||
        local.items.length > 0 ||
        local.loans.length > 0;

      if (serverIsEmpty && localHasData) {
        await pushStateToServer(local);
        return local;
      }

      if (data.initialized && serverUsers.length > 0) {
        const normalizedUsers = serverUsers.map((u: User) =>
          u.id === 'usr-admin-master'
            ? {
                ...u,
                email: INITIAL_USERS[0].email,
                password: INITIAL_USERS[0].password,
              }
            : u
        );
        setUsers(normalizedUsers);
        setItems(serverItems);
        setLoans(serverLoans);
        setEmails(serverEmails);
        return {
          users: normalizedUsers,
          items: serverItems,
          loans: serverLoans,
          emails: serverEmails,
        };
      }
    } catch {
      // Ignore network/API errors in offline preview
    }
    return null;
  }, [pushStateToServer]);

  // Initial pull & periodic real-time sync across devices (Laptop <-> Handphone)
  useEffect(() => {
    pullStateFromServer();
    const timer = setInterval(() => {
      pullStateFromServer();
    }, 5000);
    return () => clearInterval(timer);
  }, [pullStateFromServer]);

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch {
      // ignore
    }
  }, [users]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LOANS, JSON.stringify(loans));
    } catch {
      // ignore
    }
  }, [loans]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.EMAILS, JSON.stringify(emails));
    } catch {
      // ignore
    }
  }, [emails]);

  useEffect(() => {
    try {
      if (currentUserId) {
        localStorage.setItem(STORAGE_KEYS.SESSION_USER_ID, currentUserId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.SESSION_USER_ID);
      }
    } catch {
      // ignore
    }
  }, [currentUserId]);

  // Run automated email check on mount for any active loans
  useEffect(() => {
    const { newNotifications, updatedLoans } = buildAutomatedEmailNotifications(
      loans,
      emails,
      referenceTimeIso
    );
    if (newNotifications.length > 0) {
      const nextEmails = [...newNotifications, ...emails];
      setEmails(nextEmails);
      setLoans(updatedLoans);
      pushStateToServer({ emails: nextEmails, loans: updatedLoans });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId) || null,
    [users, currentUserId]
  );

  // Handlers
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const synced = await pullStateFromServer();
    const activeUsersList = synced?.users || users;
    const result = authenticateUser(activeUsersList, loginEmail, loginPassword);
    if (result.error || !result.user) {
      setLoginError(result.error || 'Gagal masuk.');
      return;
    }
    setCurrentUserId(result.user.id);
    if (result.user.role === 'admin') {
      setAdminTab('dashboard');
    } else {
      setMemberTab('catalog');
    }
  };

  const handleLogout = () => {
    setCurrentUserId(null);
    setLoginError(null);
  };

  const handleRunAutoEmailCheck = (): number => {
    const nowIso = new Date().toISOString();
    const { newNotifications, updatedLoans } = buildAutomatedEmailNotifications(
      loans,
      emails,
      nowIso
    );
    if (newNotifications.length > 0) {
      const nextEmails = [...newNotifications, ...emails];
      setEmails(nextEmails);
      setLoans(updatedLoans);
      pushStateToServer({ emails: nextEmails, loans: updatedLoans });
    }
    return newNotifications.length;
  };

  const handleSendManualReminder = (loan: LoanRecord) => {
    const nowIso = new Date().toISOString();
    const due = calculateDueState(loan, nowIso, 24);
    const isOverdue = due.state === 'terlambat';
    const newEmail: EmailNotification = {
      id: `email-man-${loan.id}-${Date.now()}`,
      recipientEmail: loan.userEmail,
      recipientName: loan.userName,
      userId: loan.userId,
      loanId: loan.id,
      itemName: loan.itemName,
      itemQrCode: loan.itemQrCode,
      type: isOverdue ? 'belum_dikembalikan' : 'batas_waktu_hampir_habis',
      subject: isOverdue
        ? `[PERINGATAN ADMIN] Barang Belum Dikembalikan: "${loan.itemName}" (${loan.itemQrCode})`
        : `[Pengingat Admin] Batas Waktu Peminjaman "${loan.itemName}" (${due.label})`,
      body: `Halo ${loan.userName},\n\nAdmin Inventaris ODipinjam mengirimkan pengingat terkait peminjaman barang "${loan.itemName}" (Kode QR: ${loan.itemQrCode}, Jumlah: ${loan.quantity} unit).\nStatus saat ini: ${due.label}.\n\nMohon segera melakukan pengembalian barang dan melampirkan bukti foto kondisi barang melalui portal Anggota.`,
      sentAt: nowIso,
      read: false,
    };
    const nextEmails = [newEmail, ...emails];
    setEmails(nextEmails);
    pushStateToServer({ emails: nextEmails });
  };

  const handleAddItem = (newItem: Omit<InventoryItem, 'id' | 'createdAt'>) => {
    const created: InventoryItem = {
      ...newItem,
      id: `itm-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const nextItems = [created, ...items];
    setItems(nextItems);
    pushStateToServer({ items: nextItems });
  };

  const handleBulkAddItems = (
    newItems: Omit<InventoryItem, 'id' | 'createdAt'>[]
  ) => {
    const nowIso = new Date().toISOString();
    const createdList: InventoryItem[] = newItems.map((it, idx) => ({
      ...it,
      id: `itm-bulk-${Date.now()}-${idx}`,
      createdAt: nowIso,
    }));
    const nextItems = [...createdList, ...items];
    setItems(nextItems);
    pushStateToServer({ items: nextItems });
  };

  const handleDeleteItem = (itemId: string) => {
    const nextItems = items.filter((i) => i.id !== itemId);
    setItems(nextItems);
    pushStateToServer({ items: nextItems });
  };

  const handleUpdateItemStock = (itemId: string, delta: number) => {
    const nextItems = items.map((item) => {
      if (item.id !== itemId) return item;
      const newTotal = Math.max(1, item.totalStock + delta);
      const newAvail = Math.max(0, item.availableStock + delta);
      return {
        ...item,
        totalStock: newTotal,
        availableStock: newAvail,
      };
    });
    setItems(nextItems);
    pushStateToServer({ items: nextItems });
  };

  const handleRegisterUser = (newUser: Omit<User, 'id' | 'createdAt'>) => {
    const created: User = {
      ...newUser,
      id: `usr-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const nextUsers = [...users, created];
    setUsers(nextUsers);
    pushStateToServer({ users: nextUsers });
  };

  const handleToggleUserActive = (userId: string) => {
    const nextUsers = users.map((u) =>
      u.id === userId ? { ...u, active: !u.active } : u
    );
    setUsers(nextUsers);
    pushStateToServer({ users: nextUsers });
  };

  const handleDeleteUser = (userId: string) => {
    const nextUsers = users.filter((u) => u.id !== userId);
    setUsers(nextUsers);
    pushStateToServer({ users: nextUsers });
  };

  const handleBorrowItem = (payload: {
    item: InventoryItem;
    quantity: number;
    entries?: Array<{ item: InventoryItem; quantity: number }>;
    borrowDate: string;
    dueDate: string;
    durationDays: number;
    purposeNotes: string;
    borrowPhotoDataUrl: string;
  }) => {
    if (!currentUser) return;

    const borrowList =
      payload.entries && payload.entries.length > 0
        ? payload.entries
        : [{ item: payload.item, quantity: payload.quantity }];

    const baseTime = Date.now();
    const newLoans: LoanRecord[] = borrowList.map((entry, idx) => ({
      id: `ln-${baseTime}-${idx}`,
      itemId: entry.item.id,
      itemQrCode: entry.item.qrCode,
      itemName: entry.item.name,
      itemCategory: entry.item.category,
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userDepartment: currentUser.department,
      quantity: entry.quantity,
      borrowDate: payload.borrowDate,
      dueDate: payload.dueDate,
      durationDays: payload.durationDays,
      purposeNotes: payload.purposeNotes,
      borrowPhotoDataUrl: payload.borrowPhotoDataUrl,
      status: 'dipinjam',
    }));

    // Decrement available stock in real-time for all borrowed items
    const qtyByItemId = new Map<string, number>();
    for (const entry of borrowList) {
      qtyByItemId.set(
        entry.item.id,
        (qtyByItemId.get(entry.item.id) || 0) + entry.quantity
      );
    }

    const nextItems = items.map((it) => {
      const deduct = qtyByItemId.get(it.id);
      if (!deduct) return it;
      return {
        ...it,
        availableStock: Math.max(0, it.availableStock - deduct),
      };
    });

    // Send confirmation emails
    const confirmEmails: EmailNotification[] = newLoans.map((ln) => ({
      id: `email-borrow-${ln.id}`,
      recipientEmail: currentUser.email,
      recipientName: currentUser.name,
      userId: currentUser.id,
      loanId: ln.id,
      itemName: ln.itemName,
      itemQrCode: ln.itemQrCode,
      type: 'konfirmasi_peminjaman',
      subject: `[Bukti Peminjaman ODipinjam] ${ln.itemName} (${ln.itemQrCode})`,
      body: `Halo ${currentUser.name},\n\nPeminjaman barang "${ln.itemName}" (Kode QR: ${ln.itemQrCode}, Jumlah: ${ln.quantity} unit) telah berhasil tercatat.\nBatas waktu pengembalian: ${new Date(payload.dueDate).toLocaleDateString('id-ID')} (${payload.durationDays} hari).\nCatatan pemakaian: ${payload.purposeNotes}\n\nSistem akan mengirimkan pengingat email otomatis apabila batas waktu peminjaman hampir habis.`,
      sentAt: payload.borrowDate,
      read: false,
    }));

    const nextLoans = [...newLoans, ...loans];
    const nextEmails = [...confirmEmails, ...emails];

    setItems(nextItems);
    setLoans(nextLoans);
    setEmails(nextEmails);
    pushStateToServer({
      items: nextItems,
      loans: nextLoans,
      emails: nextEmails,
    });
  };

  const handleReturnItem = (payload: {
    loanId: string;
    returnNotes: string;
    returnPhotoDataUrl: string;
  }) => {
    const targetLoan = loans.find((l) => l.id === payload.loanId);
    if (!targetLoan || targetLoan.status === 'dikembalikan') return;

    const nowIso = new Date().toISOString();

    const nextLoans: LoanRecord[] = loans.map((l) =>
      l.id === payload.loanId
        ? {
          ...l,
          status: 'dikembalikan',
          returnDate: nowIso,
          returnNotes: payload.returnNotes,
          returnPhotoDataUrl: payload.returnPhotoDataUrl,
        }
        : l
    );

    // Increment available stock back in real-time
    const nextItems = items.map((it) =>
      it.id === targetLoan.itemId
        ? {
          ...it,
          availableStock: Math.min(
            it.totalStock,
            it.availableStock + targetLoan.quantity
          ),
        }
        : it
    );

    const returnEmail: EmailNotification = {
      id: `email-return-${targetLoan.id}-${Date.now()}`,
      recipientEmail: targetLoan.userEmail,
      recipientName: targetLoan.userName,
      userId: targetLoan.userId,
      loanId: targetLoan.id,
      itemName: targetLoan.itemName,
      itemQrCode: targetLoan.itemQrCode,
      type: 'konfirmasi_pengembalian',
      subject: `[Konfirmasi Pengembalian] ${targetLoan.itemName} (${targetLoan.itemQrCode})`,
      body: `Halo ${targetLoan.userName},\n\nTerima kasih, barang "${targetLoan.itemName}" (${targetLoan.itemQrCode}) sebanyak ${targetLoan.quantity} unit telah diterima kembali pada ${new Date(nowIso).toLocaleString('id-ID')}.\nCatatan kondisi: ${payload.returnNotes}`,
      sentAt: nowIso,
      read: false,
    };

    const nextEmails = [returnEmail, ...emails];

    setLoans(nextLoans);
    setItems(nextItems);
    setEmails(nextEmails);
    pushStateToServer({
      loans: nextLoans,
      items: nextItems,
      emails: nextEmails,
    });
  };

  const handleMarkEmailsRead = (userId: string) => {
    const nextEmails = emails.map((e) =>
      e.userId === userId ? { ...e, read: true } : e
    );
    setEmails(nextEmails);
    pushStateToServer({ emails: nextEmails });
  };

  // RENDER LOGIN VIEW IF NOT AUTHENTICATED
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
        {/* Top Bar Contract */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
          <a
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-[#0d113a] whitespace-nowrap shrink-0"
          >
            <img
              src="/logo-icon.svg"
              alt="ODipinjam Logo"
              className="w-8 h-8 rounded-lg object-contain"
            />
            <span>ODipinjam</span>
          </a>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href="#login-email-input"
              className="px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151a54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              Masuk Sistem
            </a>
          </div>
        </header>

        {/* Main Login Split Container */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Platform Capabilities Overview */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#e71f69]/10 text-[#e71f69] text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#e71f69]"></span>
                Sistem Manajemen Aset & Peminjaman Barang
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#0d113a] leading-tight">
                Kelola Inventaris, Scan Kode QR, dan Pantau Pengembalian Barang Secara Real-Time.
              </h1>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0d113a]">
                  <ShieldCheck className="w-4 h-4 text-[#e71f69]" />
                  <span>Panel Kontrol Admin Menyeluruh</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Monitor ketersediaan real-time, cetak label QR, impor CSV/Excel, kelola akun anggota, dan unduh laporan peminjaman bulanan.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0d113a]">
                  <QrCode className="w-4 h-4 text-[#e71f69]" />
                  <span>Portal Pinjam & Kembali Anggota</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Scan QR barang, atur durasi peminjaman, catat keperluan pemakaian, unggah bukti foto kondisi barang, dan terima pengingat email.
                </p>
              </div>
            </div>

            {/* Live Inventory Snapshot Strip */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Status Sistem Saat Ini:</span>
                <strong className="font-mono tabular-nums text-[#0d113a]">
                  {items.length} jenis barang
                </strong>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <strong className="font-mono tabular-nums text-emerald-700">
                  {items.reduce((a, b) => a + b.availableStock, 0)} unit tersedia
                </strong>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <strong className="font-mono tabular-nums text-[#e71f69]">
                  {loans.filter((l) => l.status === 'dipinjam').length} pinjaman aktif
                </strong>
              </div>
            </div>
          </div>

          {/* Right Column: Role-Based Login Card */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <img
                  src="/logo-icon.svg"
                  alt="ODipinjam"
                  className="w-10 h-10 object-contain rounded-lg border border-slate-100 p-0.5"
                />
                <div>
                  <h2 className="text-base font-bold text-[#0d113a]">
                    Masuk ke Akun ODipinjam
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pilih peran akses dan masukkan email serta password terdaftar
                  </p>
                </div>
              </div>
            </div>

            {/* Role Selector Tabs */}
            <div className="mt-4 grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setLoginRoleTab('admin');
                  setLoginError(null);
                }}
                className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${loginRoleTab === 'admin'
                  ? 'bg-white text-[#0d113a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                <ShieldCheck className={`w-3.5 h-3.5 ${loginRoleTab === 'admin' ? 'text-[#e71f69]' : 'text-slate-400'}`} />
                Login Admin
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginRoleTab('anggota');
                  setLoginError(null);
                }}
                className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${loginRoleTab === 'anggota'
                  ? 'bg-white text-[#0d113a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                <UserCheck className={`w-3.5 h-3.5 ${loginRoleTab === 'anggota' ? 'text-[#e71f69]' : 'text-slate-400'}`} />
                Login Anggota
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="login-email-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Alamat Email
                </label>
                <input
                  id="login-email-input"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={
                    loginRoleTab === 'admin'
                      ? 'admin@gmail.com'
                      : 'nama.anggota@gmail.com'
                  }
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Password
                </label>
                <input
                  id="login-password-input"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                />
              </div>

              {loginError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-600">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151a54] rounded-lg transition-colors shadow-xs"
              >
                Masuk Sekarang
              </button>
            </form>
          </div>
        </main>

        <footer className="bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>ODipinjam — Sistem Manajemen Peminjaman & Inventaris  </span>
          <span>Pelacakan Kode QR · Bukti Foto · Pengingat Email Otomatis</span>
        </footer>
      </div>
    );
  }

  const isAdmin = currentUser.role === 'admin';
  const unreadMemberEmails = emails.filter(
    (e) =>
      (e.userId === currentUser.id ||
        e.recipientEmail.toLowerCase() === currentUser.email.toLowerCase()) &&
      !e.read
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar Workspace Navigation (260px on desktop) */}
      <aside
        aria-label="Navigasi Utama"
        className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 shrink-0 flex flex-col justify-between"
      >
        <div>
          {/* Brand Header */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/logo-icon.svg"
                alt="ODipinjam"
                className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 border border-slate-200 shadow-2xs"
              />
              <div>
                <span className="text-sm font-bold text-[#0d113a] tracking-tight block leading-none">
                  ODipinjam
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  {isAdmin ? 'Administrator Console' : 'Portal Anggota'}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className={`p-2.5 sm:p-3 flex items-center ${isAdmin ? 'justify-start lg:items-stretch' : 'justify-around lg:justify-start'} lg:flex-col gap-1.5 overflow-x-auto`}>
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => setAdminTab('dashboard')}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left shrink-0 ${adminTab === 'dashboard'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  <span>Dasbor</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('inventory')}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left shrink-0 ${adminTab === 'inventory'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <QrCode className="w-4 h-4 shrink-0" />
                  <span>Daftar Barang</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('loans')}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left shrink-0 ${adminTab === 'loans'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <ClipboardList className="w-4 h-4 shrink-0" />
                  <span>Riwayat Pinjam</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('users')}
                  className={`w-full flex items-center justify-start gap-2.5 px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left shrink-0 ${adminTab === 'users'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Kelola Anggota</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAdminTab('emails')}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left shrink-0 ${adminTab === 'emails'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 shrink-0" />
                    <span>Notifikasi Email</span>
                  </span>
                  <span className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded-full ${adminTab === 'emails' ? 'bg-[#e71f69] text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {emails.length}
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMemberTab('catalog')}
                  title="Dasbor & Katalog Barang"
                  aria-label="Dasbor & Katalog Barang"
                  className={`flex-1 lg:flex-initial flex items-center justify-center p-2.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${memberTab === 'catalog'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <Package className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setMemberTab('borrow')}
                  title="Pinjam Barang (Scan QR)"
                  aria-label="Pinjam Barang (Scan QR)"
                  className={`flex-1 lg:flex-initial flex items-center justify-center p-2.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${memberTab === 'borrow'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <ScanLine className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setMemberTab('return')}
                  title="Pengembalian Barang"
                  aria-label="Pengembalian Barang"
                  className={`flex-1 lg:flex-initial flex items-center justify-center p-2.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${memberTab === 'return'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <RotateCcw className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleMarkEmailsRead(currentUser.id);
                    setMemberTab('notifications');
                  }}
                  title="Kotak Masuk Email"
                  aria-label="Kotak Masuk Email"
                  className={`relative flex-1 lg:flex-initial flex items-center justify-center p-2.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${memberTab === 'notifications'
                    ? 'bg-[#0d113a] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <Mail className="w-5 h-5" />
                  {unreadMemberEmails > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 min-w-4 px-1 items-center justify-center text-[10px] font-bold text-white bg-[#e71f69] rounded-full tabular-nums">
                      {unreadMemberEmails}
                    </span>
                  )}
                </button>
              </>
            )}
          </nav>
        </div>

        {/* Bottom Account Info & Logout */}
        <div className="hidden lg:block p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">
              {currentUser.name}
            </p>
            <p className="font-mono text-slate-500 truncate text-[11px]">
              {currentUser.email}
            </p>
            <p className="text-slate-400 text-[11px] mt-0.5">
              {currentUser.department}
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Workspace Top Bar Contract */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
            <span className="font-medium text-slate-900">
              {isAdmin ? 'Admin Console' : 'Portal Anggota'}
            </span>
            <span aria-hidden="true">/</span>
            <span className="truncate">
              {isAdmin
                ? adminTab === 'dashboard'
                  ? 'Monitor & Laporan'
                  : adminTab === 'inventory'
                    ? 'Inventaris Barang'
                    : adminTab === 'loans'
                      ? 'Riwayat Peminjaman & Bukti Foto'
                      : adminTab === 'users'
                        ? 'Kelola Data Anggota & User'
                        : 'Log Notifikasi Email'
                : memberTab === 'catalog'
                  ? 'Katalog Barang & Pinjaman Saya'
                  : memberTab === 'borrow'
                    ? 'Formulir Pinjam Barang (Scan QR & Bukti Foto)'
                    : memberTab === 'return'
                      ? 'Formulir Pengembalian Barang'
                      : 'Kotak Masuk Email Pengingat'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-600">
              {currentUser.name} ({isAdmin ? 'Admin' : 'Anggota'})
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {isAdmin ? (
            <>
              {adminTab === 'dashboard' && (
                <AdminDashboardView
                  items={items}
                  loans={loans}
                  users={users}
                  emails={emails}
                  referenceTimeIso={referenceTimeIso}
                  onRunAutoEmailCheck={handleRunAutoEmailCheck}
                  onInspectQr={(item) => setInspectedQrItem(item)}
                  onNavigateTab={(tab) => setAdminTab(tab)}
                />
              )}
              {adminTab === 'inventory' && (
                <AdminInventoryView
                  items={items}
                  onAddItem={handleAddItem}
                  onBulkAddItems={handleBulkAddItems}
                  onDeleteItem={handleDeleteItem}
                  onUpdateItemStock={handleUpdateItemStock}
                  onInspectQr={(item) => setInspectedQrItem(item)}
                />
              )}
              {adminTab === 'loans' && (
                <AdminLoansAndEmailsView
                  mode="loans"
                  loans={loans}
                  emails={emails}
                  referenceTimeIso={referenceTimeIso}
                  onRunAutoEmailCheck={handleRunAutoEmailCheck}
                  onSendManualReminder={handleSendManualReminder}
                />
              )}
              {adminTab === 'users' && (
                <AdminUsersView
                  users={users}
                  loans={loans}
                  currentUserId={currentUser.id}
                  onRegisterUser={handleRegisterUser}
                  onToggleUserActive={handleToggleUserActive}
                  onDeleteUser={handleDeleteUser}
                />
              )}
              {adminTab === 'emails' && (
                <AdminLoansAndEmailsView
                  mode="emails"
                  loans={loans}
                  emails={emails}
                  referenceTimeIso={referenceTimeIso}
                  onRunAutoEmailCheck={handleRunAutoEmailCheck}
                  onSendManualReminder={handleSendManualReminder}
                />
              )}
            </>
          ) : (
            <MemberPortalView
              currentUser={currentUser}
              activeTab={memberTab}
              onChangeTab={setMemberTab}
              items={items}
              loans={loans}
              emails={emails}
              referenceTimeIso={referenceTimeIso}
              onBorrowItem={handleBorrowItem}
              onReturnItem={handleReturnItem}
              onMarkEmailsRead={handleMarkEmailsRead}
            />
          )}
        </main>
      </div>

      {/* Printable / Downloadable QR Code Modal */}
      <QrLabelModal
        item={inspectedQrItem}
        onClose={() => setInspectedQrItem(null)}
      />
    </div>
  );
}
