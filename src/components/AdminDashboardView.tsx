import React, { useMemo, useState } from 'react';
import {
  EmailNotification,
  InventoryItem,
  LoanRecord,
  User,
} from '../types/inventory';
import {
  calculateDueState,
  computeMonthlyLoanReport,
} from '../utils/inventoryLogic';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Mail,
  Package,
  QrCode,
  Search,
} from 'lucide-react';

interface AdminDashboardViewProps {
  items: InventoryItem[];
  loans: LoanRecord[];
  users: User[];
  emails: EmailNotification[];
  referenceTimeIso: string;
  onRunAutoEmailCheck: () => number;
  onInspectQr: (item: InventoryItem) => void;
  onNavigateTab: (tab: 'dashboard' | 'inventory' | 'loans' | 'users' | 'emails') => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  items,
  loans,
  users,
  emails,
  referenceTimeIso,
  onRunAutoEmailCheck,
  onInspectQr,
  onNavigateTab,
}) => {
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>('ALL');
  const [availabilityFilter, setAvailabilityFilter] = useState<
    'all' | 'available' | 'low'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalTitles = items.length;
    const totalUnits = items.reduce((acc, i) => acc + i.totalStock, 0);
    const availableUnits = items.reduce((acc, i) => acc + i.availableStock, 0);
    const activeLoans = loans.filter((l) => l.status === 'dipinjam');

    let dueSoonCount = 0;
    let overdueCount = 0;
    for (const l of activeLoans) {
      const d = calculateDueState(l, referenceTimeIso, 24);
      if (d.state === 'hampir_habis') dueSoonCount++;
      if (d.state === 'terlambat') overdueCount++;
    }

    return {
      totalTitles,
      totalUnits,
      availableUnits,
      borrowedUnits: totalUnits - availableUnits,
      activeLoansCount: activeLoans.length,
      dueSoonCount,
      overdueCount,
      memberCount: users.filter((u) => u.role === 'anggota').length,
    };
  }, [items, loans, users, referenceTimeIso]);

  const monthlyReports = useMemo(
    () => computeMonthlyLoanReport(loans, referenceTimeIso),
    [loans, referenceTimeIso]
  );

  const filteredMonthlyLoans = useMemo(() => {
    if (selectedMonthKey === 'ALL') return loans;
    return loans.filter((l) => l.borrowDate.startsWith(selectedMonthKey));
  }, [loans, selectedMonthKey]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesQ =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.qrCode.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q);

      if (!matchesQ) return false;
      if (availabilityFilter === 'available') return item.availableStock > 0;
      if (availabilityFilter === 'low')
        return item.availableStock === 0 || item.availableStock < item.totalStock;
      return true;
    });
  }, [items, searchQuery, availabilityFilter]);

  const handleTriggerEmails = () => {
    const count = onRunAutoEmailCheck();
    if (count > 0) {
      setDispatchMessage(
        `${count} email pengingat baru berhasil dikirim otomatis ke anggota.`
      );
    } else {
      setDispatchMessage(
        'Seluruh anggota dengan pinjaman hampir habis / terlambat sudah menerima email notifikasi.'
      );
    }
    setTimeout(() => setDispatchMessage(null), 5000);
  };

  const handleExportMonthlyCsv = () => {
    const headers = [
      'Bulan',
      'Total Transaksi Peminjaman',
      'Unit Dipinjam',
      'Masih Dipinjam',
      'Sudah Dikembalikan',
      'Terlambat',
      'Kategori Terbanyak',
    ];
    const rows = monthlyReports.map((r) => [
      r.monthLabel,
      r.totalLoans,
      r.totalUnitsBorrowed,
      r.activeLoans,
      r.returnedLoans,
      r.overdueCount,
      r.topCategory,
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laporan-Bulanan-ODipinjam-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Top KPI Grid */}
      <section aria-label="Ringkasan Metrik Real-Time">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Ketersediaan Unit</span>
              <Package className="w-4 h-4 text-slate-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {stats.availableUnits}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                / {stats.totalUnits} unit ({stats.totalTitles} jenis)
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {stats.borrowedUnits} unit sedang dipinjam
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Peminjaman Aktif</span>
              <Clock className="w-4 h-4 text-[#e71f69]" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {stats.activeLoansCount}
              </span>
              <span className="text-xs text-slate-500">transaksi berjalan</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Dari {stats.memberCount} anggota terdaftar aktif
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Hampir Habis & Belum Kembali</span>
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-600 font-mono tabular-nums">
                {stats.overdueCount}
              </span>
              <span className="text-xs text-slate-600">terlambat</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-xs text-slate-600">
                <strong className="font-mono tabular-nums text-amber-700">
                  {stats.dueSoonCount}
                </strong>{' '}
                hampir habis
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Notifikasi Email Terkirim</span>
              <Mail className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {emails.length}
              </span>
              <span className="text-xs text-slate-500">email otomatis</span>
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onNavigateTab('emails')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#e71f69] hover:text-[#d1165a] transition-colors"
              >
                Lihat log pengiriman email
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Automated Email Alert Strip */}
      {(stats.overdueCount > 0 || stats.dueSoonCount > 0) && (
        <section
          aria-label="Status Pengingat Email Otomatis"
          className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Peringatan Batas Waktu & Keterlambatan Pengembalian Barang
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Terdapat{' '}
              <span className="font-mono font-semibold text-amber-700 tabular-nums">
                {stats.dueSoonCount}
              </span>{' '}
              peminjaman yang batas waktunya hampir habis (&le; 24 jam) dan{' '}
              <span className="font-mono font-semibold text-red-600 tabular-nums">
                {stats.overdueCount}
              </span>{' '}
              peminjaman yang melewati batas waktu pengembalian.
            </p>
            {dispatchMessage && (
              <p className="text-xs font-medium text-emerald-700 pt-1">
                {dispatchMessage}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleTriggerEmails}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              <Mail className="w-3.5 h-3.5" />
              Kirim Email Pengingat Otomatis
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('loans')}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Tinjau Peminjaman
            </button>
          </div>
        </section>
      )}

      {/* Real-Time Inventory Tracking Table */}
      <section
        aria-label="Pelacakan Ketersediaan Inventaris Real-Time"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Monitor Ketersediaan Barang
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama barang, QR, lokasi..."
                aria-label="Cari barang di dasbor"
                className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a] w-56"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setAvailabilityFilter('all')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${availabilityFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Semua ({items.length})
              </button>
              <button
                type="button"
                onClick={() => setAvailabilityFilter('available')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${availabilityFilter === 'available'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Tersedia
              </button>
              <button
                type="button"
                onClick={() => setAvailabilityFilter('low')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${availabilityFilter === 'low'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Sedang Dipinjam
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Kode QR</th>
                <th className="py-3 px-4">Nama Barang & Spesifikasi</th>
                <th className="py-3 px-4">Kategori · Lokasi</th>
                <th className="py-3 px-4 text-right">Tersedia</th>
                <th className="py-3 px-4 text-right">Total Unit</th>
                <th className="py-3 px-4">Status Ketersediaan</th>
                <th className="py-3 px-4 text-right">Aksi QR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    <p className="font-medium text-slate-700">
                      Belum ada data barang di dalam inventaris.
                    </p>
                    <p className="mt-1">
                      Tambahkan barang baru atau gunakan fitur Bulk Import CSV/Excel pada menu Inventaris.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('inventory')}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors shadow-xs"
                    >
                      Tambah Barang Inventaris
                    </button>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Tidak ada barang yang cocok dengan pencarian Anda.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const borrowedCount = item.totalStock - item.availableStock;
                  const isEmpty = item.availableStock === 0;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {item.qrCode}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-slate-500 line-clamp-1 mt-0.5">
                          {item.description}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        <span>{item.category}</span>
                        <span aria-hidden="true" className="mx-1.5 text-slate-300">
                          ·
                        </span>
                        <span>{item.location}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {item.availableStock}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                        {item.totalStock}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isEmpty ? (
                          <span className="inline-flex items-center gap-1.5 text-red-600 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Habis Dipinjam ({borrowedCount} unit)
                          </span>
                        ) : borrowedCount > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Tersedia · {borrowedCount} dipinjam
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Stok Penuh
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onInspectQr(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          Label QR
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

      {/* Monthly Loan Report Section */}
      <section
        aria-label="Laporan Peminjaman Bulanan"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#0d113a]" />
              <h2 className="text-base font-semibold text-slate-900">
                Laporan Peminjaman Bulanan
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <label htmlFor="month-filter-select" className="sr-only">
              Filter Bulan Laporan
            </label>
            <select
              id="month-filter-select"
              value={selectedMonthKey}
              onChange={(e) => setSelectedMonthKey(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            >
              <option value="ALL">Semua Periode ({loans.length} transaksi)</option>
              {monthlyReports.map((m) => (
                <option key={m.monthKey} value={m.monthKey}>
                  {m.monthLabel} ({m.totalLoans} transaksi)
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={monthlyReports.length === 0}
              onClick={handleExportMonthlyCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Laporan CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Periode Bulan</th>
                <th className="py-3 px-4 text-right">Total Transaksi</th>
                <th className="py-3 px-4 text-right">Total Unit Dipinjam</th>
                <th className="py-3 px-4 text-right">Sudah Dikembalikan</th>
                <th className="py-3 px-4 text-right">Masih Dipinjam</th>
                <th className="py-3 px-4 text-right">Terlambat</th>
                <th className="py-3 px-4">Kategori Dominan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {monthlyReports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Belum ada transaksi peminjaman untuk dirangkum ke dalam laporan bulanan.
                  </td>
                </tr>
              ) : (
                monthlyReports.map((rep) => {
                  const isSelected = selectedMonthKey === rep.monthKey;
                  return (
                    <tr
                      key={rep.monthKey}
                      onClick={() =>
                        setSelectedMonthKey(isSelected ? 'ALL' : rep.monthKey)
                      }
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-[#e71f69]/10' : 'hover:bg-slate-50/80'
                        }`}
                    >
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {rep.monthLabel}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {rep.totalLoans}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {rep.totalUnitsBorrowed} unit
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                        {rep.returnedLoans}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#e71f69] font-medium">
                        {rep.activeLoans}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-red-600 font-medium">
                        {rep.overdueCount}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{rep.topCategory}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Filtered Month Transaction Detail Preview */}
        <div className="p-4 bg-slate-50/60 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            Menampilkan{' '}
            <strong className="font-mono tabular-nums text-slate-900">
              {filteredMonthlyLoans.length}
            </strong>{' '}
            catatan transaksi peminjaman pada periode yang dipilih.
          </span>
          <button
            type="button"
            onClick={() => onNavigateTab('loans')}
            className="inline-flex items-center gap-1 font-medium text-[#e71f69] hover:text-[#d1165a] transition-colors"
          >
            Buka Riwayat Peminjaman & Bukti Foto Lengkap
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
};
