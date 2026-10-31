import React, { useMemo, useState } from 'react';
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
  Send,
  X,
} from 'lucide-react';

interface AdminLoansAndEmailsViewProps {
  mode: 'loans' | 'emails';
  loans: LoanRecord[];
  emails: EmailNotification[];
  referenceTimeIso: string;
  onRunAutoEmailCheck: () => number;
  onSendManualReminder: (loan: LoanRecord) => void;
}

export const AdminLoansAndEmailsView: React.FC<AdminLoansAndEmailsViewProps> = ({
  mode,
  loans,
  emails,
  referenceTimeIso,
  onRunAutoEmailCheck,
  onSendManualReminder,
}) => {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'due_soon' | 'overdue' | 'returned'
  >('all');
  const [inspectedLoanPhoto, setInspectedLoanPhoto] =
    useState<LoanRecord | null>(null);
  const [inspectedEmail, setInspectedEmail] =
    useState<EmailNotification | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

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
    setFeedbackMsg(
      sent > 0
        ? `${sent} email notifikasi otomatis baru berhasil dikirim ke anggota.`
        : 'Semua peminjaman yang hampir habis atau terlambat telah dikirimi email pengingat.'
    );
    setTimeout(() => setFeedbackMsg(null), 4500);
  };

  const handleManualEmail = (loan: LoanRecord) => {
    onSendManualReminder(loan);
    setFeedbackMsg(
      `Email pengingat untuk "${loan.itemName}" berhasil dikirim ke ${loan.userEmail}.`
    );
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  if (mode === 'emails') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Notifikasi Email Otomatis (Batas Waktu & Keterlambatan)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sistem memantau batas waktu peminjaman secara real-time dan mengirimkan email otomatis ke anggota
            </p>
          </div>
          <button
            type="button"
            onClick={handleTriggerAutoCheck}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            Jalankan Pengecekan & Kirim Email Sekarang
          </button>
        </div>

        {feedbackMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 text-xs font-medium text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        <section
          aria-label="Log Pengiriman Email"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Riwayat Email Terkirim ke Anggota ({emails.length} pesan)
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Waktu Kirim</th>
                  <th className="py-3 px-4">Penerima (Anggota)</th>
                  <th className="py-3 px-4">Jenis Notifikasi</th>
                  <th className="py-3 px-4">Subjek & Barang</th>
                  <th className="py-3 px-4 text-right">Isi Pesan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {emails.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
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
                          <span className="inline-flex items-center gap-1 font-medium text-[#e71f69]">
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
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectedEmail(em)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Baca Email
                        </button>
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
                  <Mail className="w-4 h-4 text-[#e71f69]" />
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

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInspectedEmail(null)}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
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

  // Loans History & Real-time Monitoring View
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Riwayat Peminjaman, Bukti Foto & Status Pengembalian
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pantau seluruh transaksi peminjaman aktif, catatan keperluan, bukti foto serah terima, dan kirim pengingat email
          </p>
        </div>

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

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 text-xs font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMsg}</span>
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
                <th className="py-3 px-4">Barang & Kode QR</th>
                <th className="py-3 px-4">Peminjam (Anggota)</th>
                <th className="py-3 px-4">Pinjam · Batas Kembali</th>
                <th className="py-3 px-4">Catatan Kebutuhan</th>
                <th className="py-3 px-4">Status & Tenggat</th>
                <th className="py-3 px-4 text-right">Bukti Foto & Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredLoans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Tidak ada transaksi peminjaman pada kategori filter ini.
                  </td>
                </tr>
              ) : (
                filteredLoans.map((loan) => {
                  const due = calculateDueState(loan, referenceTimeIso, 24);
                  return (
                    <tr
                      key={loan.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
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
                          <span className="inline-flex items-center gap-1 font-medium text-[#e71f69]">
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
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#e71f69] bg-[#e71f69]/10 hover:bg-[#e71f69]/20 rounded transition-colors"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              Ingatkan Email
                            </button>
                          )}
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
                className="px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
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
