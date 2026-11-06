import React, { useEffect, useMemo, useState } from 'react';
import {
  EmailNotification,
  LoanRecord,
} from '../types/inventory';
import { calculateDueState } from '../utils/inventoryLogic';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

interface AdminLoansAndEmailsViewProps {
  mode: 'loans' | 'emails';
  loans: LoanRecord[];
  emails: EmailNotification[];
  referenceTimeIso: string;
  onRunAutoEmailCheck: () => number;
  onSendManualReminder: (loan: LoanRecord) => void;
  onDeleteLoans: (loanIds: string[]) => void;
  onDeleteEmails?: (emailIds: string[]) => void;
  onRefreshState?: () => void;
}

export const AdminLoansAndEmailsView: React.FC<AdminLoansAndEmailsViewProps> = ({
  mode,
  loans,
  emails,
  referenceTimeIso,
  onRunAutoEmailCheck,
  onSendManualReminder,
  onDeleteLoans,
  onDeleteEmails,
  onRefreshState,
}) => {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'due_soon' | 'overdue' | 'returned'
  >('all');
  const [selectedLoanIds, setSelectedLoanIds] = useState<string[]>([]);
  const [inspectedLoanPhoto, setInspectedLoanPhoto] =
    useState<LoanRecord | null>(null);
  const [inspectedEmail, setInspectedEmail] =
    useState<EmailNotification | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // SMTP Real Email Configuration State
  const [showSmtpPanel, setShowSmtpPanel] = useState(false);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('onedreamcreativeindonesia@gmail.com');
  const [smtpPass, setSmtpPass] = useState('');
  const [senderName, setSenderName] = useState('ODipinjam - OneDream Creative Indonesia');
  const [hasSavedPass, setHasSavedPass] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'emails') {
      fetch('/api/smtp-config')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setSmtpHost(data.smtpHost || 'smtp.gmail.com');
            setSmtpPort(Number(data.smtpPort) || 465);
            setSmtpSecure(Boolean(data.smtpSecure));
            setSmtpUser(data.smtpUser || 'onedreamcreativeindonesia@gmail.com');
            setSenderName(data.senderName || 'ODipinjam - OneDream Creative Indonesia');
            setHasSavedPass(Boolean(data.hasPassword));
            if (!data.hasPassword) {
              setShowSmtpPanel(true);
            }
          }
        })
        .catch(() => {
          // ignore offline
        });
    }
  }, [mode]);

  const showBanner = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'returned') return loan.status === 'dikembalikan';
      if (loan.status === 'dikembalikan') return false;

      const due = calculateDueState(loan, referenceTimeIso, 24);
      if (statusFilter === 'active') return true;
      if (statusFilter === 'due_soon') return due.state === 'hampir_habis';
      if (statusFilter === 'overdue') return due.state === 'terlambat';
      return true;
    });
  }, [loans, statusFilter, referenceTimeIso]);

  const handleTriggerAutoCheck = () => {
    const sent = onRunAutoEmailCheck();
    showBanner(
      sent > 0
        ? `${sent} email notifikasi otomatis baru berhasil dikirim ke email anggota.`
        : 'Semua peminjaman yang hampir habis atau terlambat telah dikirimi email pengingat.'
    );
  };

  const handleManualEmail = (loan: LoanRecord) => {
    onSendManualReminder(loan);
    showBanner(
      `Email pengingat untuk "${loan.itemName}" sedang dikirim ke alamat email ${loan.userEmail}.`
    );
  };

  const handleToggleSelectLoan = (loanId: string) => {
    setSelectedLoanIds((prev) =>
      prev.includes(loanId)
        ? prev.filter((id) => id !== loanId)
        : [...prev, loanId]
    );
  };

  const handleToggleSelectAllLoans = () => {
    if (
      filteredLoans.length > 0 &&
      filteredLoans.every((l) => selectedLoanIds.includes(l.id))
    ) {
      setSelectedLoanIds([]);
    } else {
      setSelectedLoanIds(filteredLoans.map((l) => l.id));
    }
  };

  const handleDeleteSingleLoan = (loan: LoanRecord) => {
    onDeleteLoans([loan.id]);
    setSelectedLoanIds((prev) => prev.filter((id) => id !== loan.id));
    showBanner(
      loan.status === 'dipinjam'
        ? `Data pinjaman "${loan.itemName}" (${loan.userName}) dihapus & ${loan.quantity} unit stok telah dikembalikan ke inventaris.`
        : `Riwayat pinjaman "${loan.itemName}" (${loan.userName}) berhasil dihapus.`
    );
  };

  const handleDeleteSelectedLoans = () => {
    if (selectedLoanIds.length === 0) return;
    const count = selectedLoanIds.length;
    onDeleteLoans(selectedLoanIds);
    setSelectedLoanIds([]);
    showBanner(
      `${count} data peminjaman berhasil dihapus dan stok pinjaman aktif telah dikembalikan.`
    );
  };

  const handleSaveSmtpConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpLoading(true);
    try {
      const res = await fetch('/api/smtp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost,
          smtpPort,
          smtpSecure,
          smtpUser,
          smtpPass,
          senderName,
          enabled: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setHasSavedPass(Boolean(data.hasPassword));
        setSmtpPass('');
        showBanner(
          'Pengaturan SMTP Email Pengirim berhasil disimpan! Sistem siap mengirim email otomatis ke Gmail/Email anggota.'
        );
      } else {
        showBanner(data.error || 'Gagal menyimpan pengaturan SMTP.', 'error');
      }
    } catch {
      showBanner('Gagal menghubungi server untuk menyimpan pengaturan SMTP.', 'error');
    } finally {
      setSmtpLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    const target = (testRecipient || smtpUser).trim();
    if (!target) {
      showBanner('Masukkan alamat email tujuan untuk tes pengiriman.', 'error');
      return;
    }
    setSmtpLoading(true);
    try {
      // Save current config first if user typed a new password
      if (smtpPass.trim()) {
        await fetch('/api/smtp-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smtpHost,
            smtpPort,
            smtpSecure,
            smtpUser,
            smtpPass,
            senderName,
            enabled: true,
          }),
        });
        setHasSavedPass(true);
        setSmtpPass('');
      }

      const res = await fetch('/api/smtp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRecipient: target }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showBanner(data.message || `Email tes berhasil dikirim ke ${target}!`);
      } else {
        showBanner(
          data.error ||
            'Gagal mengirim email tes. Pastikan App Password Gmail (16 digit) atau kredensial SMTP sudah benar.',
          'error'
        );
      }
    } catch {
      showBanner('Gagal menghubungi server email.', 'error');
    } finally {
      setSmtpLoading(false);
    }
  };

  const handleResendRealEmail = async (em: EmailNotification) => {
    setSendingEmailId(em.id);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showBanner(
          `Email "${em.subject}" berhasil dikirim langsung ke kotak masuk ${em.recipientEmail}!`
        );
        onRefreshState?.();
      } else {
        showBanner(
          data.error ||
            `Gagal mengirim ke ${em.recipientEmail}. Periksa pengaturan App Password Gmail / SMTP di atas.`,
          'error'
        );
        setShowSmtpPanel(true);
      }
    } catch {
      showBanner('Gagal menghubungi server pengiriman email.', 'error');
    } finally {
      setSendingEmailId(null);
    }
  };

  if (mode === 'emails') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Pengiriman Email Otomatis ke Gmail / Email Anggota
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sistem mengirimkan email asli (SMTP/Gmail) secara otomatis ke kotak masuk masing-masing anggota saat pinjam, kembali, hampir habis, atau terlambat
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSmtpPanel((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-[#e71f69]" />
              {showSmtpPanel
                ? 'Tutup Pengaturan SMTP / Gmail'
                : 'Pengaturan Email Pengirim (Gmail / SMTP)'}
            </button>
            <button
              type="button"
              onClick={handleTriggerAutoCheck}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Cek & Kirim Email Pengingat Sekarang
            </button>
          </div>
        </div>

        {feedbackMsg && (
          <div
            className={`rounded-lg p-3.5 text-xs font-medium flex items-center gap-2 border ${
              feedbackMsg.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {feedbackMsg.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
        )}

        {/* SMTP / Gmail Configuration Panel */}
        {showSmtpPanel && (
          <section
            aria-label="Konfigurasi SMTP Email Pengirim Otomatis"
            className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[#e71f69]" />
                  Konfigurasi Server Email Pengirim (Gmail / Hostinger SMTP)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Agar sistem dapat mengirim email otomatis langsung ke kotak masuk Gmail anggota, masukkan email pengirim beserta <strong>App Password Gmail (16 digit)</strong> atau kredensial SMTP Hostinger Anda.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSmtpHost('smtp.gmail.com');
                    setSmtpPort(465);
                    setSmtpSecure(true);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                    smtpHost === 'smtp.gmail.com'
                      ? 'bg-[#0d113a] text-white border-[#0d113a]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Preset Gmail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSmtpHost('smtp.hostinger.com');
                    setSmtpPort(465);
                    setSmtpSecure(true);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                    smtpHost === 'smtp.hostinger.com'
                      ? 'bg-[#0d113a] text-white border-[#0d113a]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Preset Hostinger Email
                </button>
              </div>
            </div>

            <form
              onSubmit={handleSaveSmtpConfig}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email Pengirim (Gmail / Domain) *
                </label>
                <input
                  type="email"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="onedreamcreativeindonesia@gmail.com"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  App Password Gmail (16 Digit) / Password SMTP *
                </label>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder={
                    hasSavedPass
                      ? '•••••••• (Sudah tersimpan, isi jika ingin ganti)'
                      : 'Masukkan 16 digit App Password Gmail'
                  }
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Pengirim di Kotak Masuk
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="ODipinjam - OneDream Creative Indonesia"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  SMTP Host
                </label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  SMTP Port & SSL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => {
                      const p = Number(e.target.value) || 465;
                      setSmtpPort(p);
                      setSmtpSecure(p === 465);
                    }}
                    className="w-24 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                    />
                    SSL/TLS (Port 465)
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alamat Email untuk Tes Kirim
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    placeholder={smtpUser || 'email.tujuan@gmail.com'}
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                  <button
                    type="button"
                    disabled={smtpLoading}
                    onClick={handleSendTestEmail}
                    className="px-3 py-2 text-xs font-medium text-white bg-[#e71f69] hover:bg-[#cf165b] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Tes Kirim
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">
                  Cara mendapatkan App Password Gmail (1 menit):
                </p>
                <p>
                  1. Buka akun Google Pengirim &rarr; aktifkan <strong>Verifikasi 2 Langkah</strong>, lalu kunjungi{' '}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 underline font-medium"
                  >
                    myaccount.google.com/apppasswords
                  </a>
                  . &nbsp;2. Buat nama aplikasi <strong>ODipinjam</strong>, lalu salin <strong>16 huruf kode sandi aplikasi</strong> ke kolom di atas dan klik <strong>Simpan Pengaturan SMTP</strong>.
                </p>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={smtpLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] disabled:opacity-50 rounded-lg transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Simpan Pengaturan SMTP
                </button>
              </div>
            </form>
          </section>
        )}

        <section
          aria-label="Log Pengiriman Email"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Riwayat Email Terkirim ke Anggota ({emails.length} pesan)
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Waktu Kirim</th>
                  <th className="py-3 px-4">Penerima (Email Anggota)</th>
                  <th className="py-3 px-4">Jenis Notifikasi</th>
                  <th className="py-3 px-4">Subjek & Barang</th>
                  <th className="py-3 px-4">Status Gmail / SMTP</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {emails.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Belum ada email yang dikirimkan.
                    </td>
                  </tr>
                ) : (
                  emails.map((em) => (
                    <tr
                      key={em.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {new Date(em.sentAt).toLocaleString('id-ID', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900">
                          {em.recipientName}
                        </p>
                        <p className="font-mono text-slate-500">
                          {em.recipientEmail}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {em.type === 'belum_dikembalikan' ? (
                          <span className="inline-flex items-center gap-1 font-medium text-red-600">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Belum Dikembalikan (Terlambat)
                          </span>
                        ) : em.type === 'batas_waktu_hampir_habis' ? (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <Clock className="w-3.5 h-3.5" />
                            Batas Waktu Hampir Habis
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-sky-700">
                            <Mail className="w-3.5 h-3.5" />
                            Konfirmasi Transaksi
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">
                          {em.subject}
                        </p>
                        <p className="text-slate-500 mt-0.5 font-mono">
                          {em.itemQrCode} · {em.itemName}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {em.deliveryStatus === 'sent' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Terkirim ke Gmail
                          </span>
                        ) : em.deliveryStatus === 'failed' ? (
                          <span
                            title={em.deliveryError || 'Kredensial SMTP belum diatur'}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Perlu Kirim Ulang / SMTP
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                            <Clock className="w-3 h-3" />
                            Diproses
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={sendingEmailId === em.id}
                            onClick={() => handleResendRealEmail(em)}
                            title="Kirim / Kirim Ulang ke Kotak Masuk Gmail Anggota"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 rounded transition-colors"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                sendingEmailId === em.id ? 'animate-spin' : ''
                              }`}
                            />
                            Kirim ke Gmail
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectedEmail(em)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Baca
                          </button>
                          {onDeleteEmails && (
                            <button
                              type="button"
                              onClick={() => onDeleteEmails([em.id])}
                              aria-label="Hapus log email"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {inspectedEmail && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-preview-title"
          >
            <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-sky-600" />
                  <h3
                    id="email-preview-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Detail Notifikasi Email Terkirim
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedEmail(null)}
                  aria-label="Tutup pratinjau email"
                  className="p-1 text-slate-400 hover:text-slate-800 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2 text-xs border-b border-slate-200 pb-4">
                <p>
                  <span className="text-slate-500">Kepada:</span>{' '}
                  <strong className="text-slate-900">
                    {inspectedEmail.recipientName}
                  </strong>{' '}
                  &lt;
                  <span className="font-mono">
                    {inspectedEmail.recipientEmail}
                  </span>
                  &gt;
                </p>
                <p>
                  <span className="text-slate-500">Subjek:</span>{' '}
                  <strong className="text-slate-900">
                    {inspectedEmail.subject}
                  </strong>
                </p>
                <p>
                  <span className="text-slate-500">Waktu Pengiriman:</span>{' '}
                  <span className="font-mono tabular-nums text-slate-700">
                    {new Date(inspectedEmail.sentAt).toLocaleString('id-ID')}
                  </span>
                </p>
              </div>

              <pre className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs font-sans text-slate-800 whitespace-pre-wrap leading-relaxed">
                {inspectedEmail.body}
              </pre>

              <div className="mt-5 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => handleResendRealEmail(inspectedEmail)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  Kirim Ulang ke Gmail Penerima
                </button>
                <button
                  type="button"
                  onClick={() => setInspectedEmail(null)}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const allFilteredSelected =
    filteredLoans.length > 0 &&
    filteredLoans.every((l) => selectedLoanIds.includes(l.id));

  // Loans History & Real-time Monitoring View
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Riwayat Peminjaman, Bukti Foto & Kelola Data Pinjam
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pantau transaksi peminjaman aktif, lihat bukti foto serah terima, kirim pengingat email ke Gmail, atau hapus data pinjaman
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedLoanIds.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelectedLoans}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus Terpilih ({selectedLoanIds.length})
            </button>
          )}

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'active', label: 'Dipinjam' },
                { id: 'due_soon', label: 'Hampir Habis' },
                { id: 'overdue', label: 'Belum Kembali' },
                { id: 'returned', label: 'Dikembalikan' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`rounded-lg p-3.5 text-xs font-medium flex items-center gap-2 border ${
            feedbackMsg.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      <section
        aria-label="Tabel Riwayat Peminjaman"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={handleToggleSelectAllLoans}
                    aria-label="Pilih semua pinjaman"
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="py-3 px-4">Barang & Kode QR</th>
                <th className="py-3 px-4">Peminjam (Anggota)</th>
                <th className="py-3 px-4">Pinjam · Batas Kembali</th>
                <th className="py-3 px-4">Catatan Kebutuhan</th>
                <th className="py-3 px-4">Status & Tenggat</th>
                <th className="py-3 px-4 text-right">Bukti Foto, Email & Hapus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredLoans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Tidak ada transaksi peminjaman pada kategori filter ini.
                  </td>
                </tr>
              ) : (
                filteredLoans.map((loan) => {
                  const due = calculateDueState(loan, referenceTimeIso, 24);
                  const isChecked = selectedLoanIds.includes(loan.id);
                  return (
                    <tr
                      key={loan.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isChecked ? 'bg-sky-50/50' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectLoan(loan.id)}
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
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">
                          {loan.userName}
                        </p>
                        <p className="text-slate-500 mt-0.5">
                          {loan.userEmail} · {loan.userDepartment}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        <div>
                          Pinjam:{' '}
                          {new Date(loan.borrowDate).toLocaleDateString('id-ID')}
                        </div>
                        <div className="text-slate-900 font-medium">
                          Batas:{' '}
                          {new Date(loan.dueDate).toLocaleDateString('id-ID')}{' '}
                          ({loan.durationDays} hr)
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <p className="text-slate-800 line-clamp-2">
                          {loan.purposeNotes}
                        </p>
                        {loan.returnNotes && (
                          <p className="text-emerald-700 mt-0.5 line-clamp-1">
                            Catatan Kembali: {loan.returnNotes}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {due.state === 'selesai' ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Dikembalikan
                          </span>
                        ) : due.state === 'terlambat' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Belum Kembali · {due.label}
                          </span>
                        ) : due.state === 'hampir_habis' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                            <Clock className="w-3.5 h-3.5" />
                            Hampir Habis · {due.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-sky-700">
                            <Clock className="w-3.5 h-3.5" />
                            Dipinjam · {due.label}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setInspectedLoanPhoto(loan)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Bukti Foto
                          </button>
                          {loan.status === 'dipinjam' && (
                            <button
                              type="button"
                              onClick={() => handleManualEmail(loan)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded transition-colors"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              Ingatkan Email
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleLoan(loan)}
                            title="Hapus data peminjaman ini"
                            aria-label={`Hapus pinjaman ${loan.itemName}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Hapus
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

      {/* Photo Proof Inspection Modal */}
      {inspectedLoanPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="photo-proof-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3
                  id="photo-proof-modal-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Dokumentasi Bukti Foto Peminjaman & Pengembalian
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inspectedLoanPhoto.itemName} ({inspectedLoanPhoto.itemQrCode}) · Peminjam:{' '}
                  {inspectedLoanPhoto.userName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedLoanPhoto(null)}
                aria-label="Tutup modal bukti foto"
                className="p-1 text-slate-400 hover:text-slate-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700">
                  1. Bukti Foto Saat Peminjaman
                </span>
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                  <img
                    src={inspectedLoanPhoto.borrowPhotoDataUrl}
                    alt={`Bukti foto peminjaman ${inspectedLoanPhoto.itemName}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-xs text-slate-600">
                  Catatan Pemakaian: {inspectedLoanPhoto.purposeNotes}
                </p>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700">
                  2. Bukti Foto Saat Pengembalian
                </span>
                {inspectedLoanPhoto.returnPhotoDataUrl ? (
                  <>
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                      <img
                        src={inspectedLoanPhoto.returnPhotoDataUrl}
                        alt={`Bukti foto pengembalian ${inspectedLoanPhoto.itemName}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-xs text-emerald-700">
                      Catatan Kembali:{' '}
                      {inspectedLoanPhoto.returnNotes ||
                        'Barang dikembalikan dalam kondisi baik.'}
                    </p>
                  </>
                ) : (
                  <div className="border border-dashed border-slate-200 rounded-lg bg-slate-50 aspect-video flex flex-col items-center justify-center p-4 text-center">
                    <Clock className="w-6 h-6 text-slate-400 mb-1.5" />
                    <p className="text-xs font-medium text-slate-700">
                      Barang Masih Dipinjam
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Bukti foto pengembalian akan muncul setelah anggota mengembalikan barang.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectedLoanPhoto(null)}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
