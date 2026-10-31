import React, { useMemo, useState } from 'react';
import { InventoryItem } from '../types/inventory';
import {
  generateQrCodeString,
  parseBulkInventoryCsv,
} from '../utils/inventoryLogic';
import { SAMPLE_BULK_CSV_TEMPLATE } from '../data/seedData';
import { QrCodeSvg } from './QrCodeSvg';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  QrCode,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

interface AdminInventoryViewProps {
  items: InventoryItem[];
  onAddItem: (newItem: Omit<InventoryItem, 'id' | 'createdAt'>) => void;
  onBulkAddItems: (newItems: Omit<InventoryItem, 'id' | 'createdAt'>[]) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItemStock: (itemId: string, delta: number) => void;
  onInspectQr: (item: InventoryItem) => void;
}

export const AdminInventoryView: React.FC<AdminInventoryViewProps> = ({
  items,
  onAddItem,
  onBulkAddItems,
  onDeleteItem,
  onUpdateItemStock,
  onInspectQr,
}) => {
  // Single item registration state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [totalStock, setTotalStock] = useState('1');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState<'Baik' | 'Perlu Perawatan'>('Baik');
  const [customQr, setCustomQr] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Bulk import state
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkSuccessMessage, setBulkSuccessMessage] = useState<string | null>(
    null
  );

  // Table filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const previewQrCode = useMemo(() => {
    if (customQr.trim()) return customQr.trim().toUpperCase();
    return generateQrCodeString(
      name || 'BARANG',
      category || 'INV',
      items.length + 1
    );
  }, [name, category, customQr, items.length]);

  const parsedBulkPreview = useMemo(
    () => parseBulkInventoryCsv(bulkText, items.length),
    [bulkText, items.length]
  );

  const categories = useMemo(() => {
    const set = new Set<string>(items.map((i) => i.category));
    return ['ALL', ...Array.from(set)];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.qrCode.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, selectedCategory, searchQuery]);

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Nama barang wajib diisi.');
      return;
    }

    const parsedStock = Number.parseInt(totalStock, 10);
    if (Number.isNaN(parsedStock) || parsedStock <= 0) {
      setFormError('Jumlah stok harus berupa angka minimal 1.');
      return;
    }

    const finalQr = previewQrCode;
    if (items.some((i) => i.qrCode.toLowerCase() === finalQr.toLowerCase())) {
      setFormError(
        `Kode QR "${finalQr}" sudah digunakan oleh barang lain. Gunakan kode lain.`
      );
      return;
    }

    onAddItem({
      qrCode: finalQr,
      name: cleanName,
      category: category.trim() || 'Umum',
      totalStock: parsedStock,
      availableStock: parsedStock,
      location: location.trim() || 'Gudang Utama',
      condition,
      description:
        description.trim() ||
        `Unit inventaris ${cleanName} (${category.trim() || 'Umum'})`,
    });

    setFormSuccess(
      `Barang "${cleanName}" berhasil didaftarkan dengan Kode QR ${finalQr}.`
    );
    setName('');
    setCustomQr('');
    setDescription('');
    setTotalStock('2');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = String(evt.target?.result || '');
      setBulkText(content);
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([SAMPLE_BULK_CSV_TEMPLATE], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Template-Bulk-Import-Inventaris.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmBulkImport = () => {
    if (parsedBulkPreview.items.length === 0) return;
    onBulkAddItems(parsedBulkPreview.items);
    setBulkSuccessMessage(
      `${parsedBulkPreview.items.length} barang baru berhasil diimpor beserta Kode QR otomatis.`
    );
    setTimeout(() => setBulkSuccessMessage(null), 5000);
  };

  return (
    <div className="space-y-8">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Inventaris Barang
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setShowBulkPanel((prev) => !prev)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          {showBulkPanel
            ? 'Tutup Panel Bulk Import'
            : 'Bulk Import Barang (Excel / CSV)'}
        </button>
      </div>

      {/* Bulk Import Excel / CSV Panel */}
      {showBulkPanel && (
        <section
          aria-label="Bulk Import Daftar Barang"
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Bulk Import Daftar Barang (Unggah File CSV / Excel)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Format kolom: Nama Barang, Kategori, Total Stok, Lokasi, Kondisi, Kode QR (Opsional), Deskripsi
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh Template CSV
              </button>
              <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#e71f69] hover:bg-[#cf165b] rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0 shadow-xs">
                <Upload className="w-3.5 h-3.5" />
                Pilih File CSV / Excel (.csv, .tsv)
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,application/vnd.ms-excel"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {bulkFileName && (
            <p className="text-xs text-[#e71f69] font-medium">
              File dimuat: {bulkFileName}
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="bulk-csv-textarea"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Data CSV / Salinan Baris Spreadsheet Excel
              </label>
              <textarea
                id="bulk-csv-textarea"
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
                placeholder="Nama Barang,Kategori,Total Stok,Lokasi,Kondisi"
              />
              {parsedBulkPreview.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {parsedBulkPreview.errors.map((err, idx) => (
                    <p key={idx} className="text-xs text-red-600">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">
                  Pratinjau Barang yang Akan Diimpor ({parsedBulkPreview.items.length}{' '}
                  baris valid)
                </span>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-44 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-3">Kode QR</th>
                        <th className="py-2 px-3">Nama Barang</th>
                        <th className="py-2 px-3">Kategori</th>
                        <th className="py-2 px-3 text-right">Stok</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {parsedBulkPreview.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-mono text-slate-700 tabular-nums">
                            {it.qrCode}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">
                            {it.name}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {it.category}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {it.totalStock}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-between gap-3">
                {bulkSuccessMessage ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    {bulkSuccessMessage}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    Kode QR dibuat otomatis jika kolom Kode QR dikosongkan.
                  </span>
                )}
                <button
                  type="button"
                  disabled={parsedBulkPreview.items.length === 0}
                  onClick={handleConfirmBulkImport}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Impor {parsedBulkPreview.items.length} Barang Sekarang
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Single Item Registration + Live QR Generator */}
      <section
        aria-label="Form Pendaftaran Barang Baru & Kode QR"
        className="bg-white border border-slate-200 rounded-lg p-6"
      >
        <h3 className="text-sm font-semibold text-slate-900 pb-4 border-b border-slate-200">
          Daftarkan Barang Baru
        </h3>

        <form
          onSubmit={handleCreateItem}
          className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="item-name-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Nama Barang *
              </label>
              <input
                id="item-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Kamera Mirrorless Sony A7 IV / Proyektor Epson"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            <div>
              <label
                htmlFor="item-category-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Kategori Barang
              </label>
              <input
                id="item-category-input"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Fotografi / Komputer / Audio"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            <div>
              <label
                htmlFor="item-stock-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Jumlah Stok Total *
              </label>
              <input
                id="item-stock-input"
                type="number"
                min={1}
                value={totalStock}
                onChange={(e) => setTotalStock(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            <div>
              <label
                htmlFor="item-location-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Lokasi Penyimpanan
              </label>
              <input
                id="item-location-input"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Contoh: Rak B-02 / Ruang Server"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            <div>
              <label
                htmlFor="item-condition-select"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Kondisi Fisik
              </label>
              <select
                id="item-condition-select"
                value={condition}
                onChange={(e) =>
                  setCondition(e.target.value as 'Baik' | 'Perlu Perawatan')
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              >
                <option value="Baik">Baik (Siap Pakai)</option>
                <option value="Perlu Perawatan">Perlu Perawatan</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="item-qr-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Kode QR Kustom (Opsional — Otomatis jika kosong)
              </label>
              <input
                id="item-qr-input"
                type="text"
                value={customQr}
                onChange={(e) => setCustomQr(e.target.value)}
                placeholder={previewQrCode}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            <div>
              <label
                htmlFor="item-desc-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Spesifikasi / Kelengkapan
              </label>
              <input
                id="item-desc-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tas, baterai cadangan, kabel HDMI..."
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
              />
            </div>

            {formError && (
              <div className="sm:col-span-2 text-xs font-medium text-red-600">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="sm:col-span-2 text-xs font-medium text-emerald-700">
                {formSuccess}
              </div>
            )}

            <div className="sm:col-span-2 pt-1">
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                <QrCode className="w-4 h-4" />
                Simpan Barang & Generate Kode QR
              </button>
            </div>
          </div>

          {/* Live QR Preview Panel */}
          <div className="lg:col-span-4 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-slate-500 mb-2">
              Pratinjau Langsung Kode QR
            </span>
            <QrCodeSvg value={previewQrCode} size={136} />
            <p className="mt-3 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {previewQrCode}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 line-clamp-1">
              {name.trim() || 'Nama Barang Baru'}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {category || 'Kategori'} · {location || 'Lokasi'}
            </p>
          </div>
        </form>
      </section>

      {/* Full Inventory Catalog & QR Management Table */}
      <section
        aria-label="Daftar Inventaris Barang"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Daftar Barang ({filteredItems.length} barang)
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama atau kode QR..."
                aria-label="Cari inventaris"
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a] w-52"
              />
            </div>

            <select
              aria-label="Filter kategori inventaris"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'ALL' ? 'Semua Kategori' : cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">QR & Kode</th>
                <th className="py-3 px-4">Nama Barang</th>
                <th className="py-3 px-4">Kategori · Lokasi · Kondisi</th>
                <th className="py-3 px-4 text-right">Tersedia / Total</th>
                <th className="py-3 px-4 text-right">Kelola Stok & QR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-500">
                    Belum ada barang di dalam daftar inventaris. Silakan daftarkan barang di atas atau gunakan fitur Bulk Import CSV/Excel.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <QrCodeSvg value={item.qrCode} size={42} />
                        <span className="font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {item.qrCode}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{item.name}</p>
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
                      <span aria-hidden="true" className="mx-1.5 text-slate-300">
                        ·
                      </span>
                      <span
                        className={
                          item.condition === 'Baik'
                            ? 'text-emerald-700 font-medium'
                            : 'text-amber-700 font-medium'
                        }
                      >
                        {item.condition}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-slate-900">
                        {item.availableStock}
                      </span>
                      <span className="text-slate-400"> / {item.totalStock}</span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onUpdateItemStock(item.id, 1)}
                          aria-label={`Tambah stok ${item.name}`}
                          className="px-2 py-1 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                        >
                          +1 Stok
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectQr(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#e71f69] bg-[#e71f69]/10 hover:bg-[#e71f69]/20 rounded transition-colors"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          Cetak QR
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          aria-label={`Hapus ${item.name}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
