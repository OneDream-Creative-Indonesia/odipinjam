import React, { useMemo, useState } from 'react';
import { BulkInventoryRowInput, InventoryItem } from '../types/inventory';
import {
  buildInventoryExcelTemplateXlsx,
  generateQrCodeString,
  handleDriveImageError,
  normalizeGoogleDriveImageUrl,
  parseInventoryExcelXlsx,
  parseSpreadsheetTextToRows,
  validateBulkInventoryRows,
} from '../utils/inventoryLogic';
import {
  downloadBulkItemsQrPng,
  downloadSingleItemQrPng,
} from '../utils/qrPngDownload';
import {
  createSampleItemIllustrationSvg,
  SAMPLE_BULK_CSV_TEMPLATE,
  SAMPLE_BULK_TEMPLATE_ROWS,
} from '../data/seedData';
import { QrCodeSvg } from './QrCodeSvg';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Image as ImageIcon,
  Pencil,
  Plus,
  QrCode,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface AdminInventoryViewProps {
  items: InventoryItem[];
  onAddItem: (newItem: Omit<InventoryItem, 'id' | 'createdAt'>) => void;
  onBulkAddItems: (newItems: Omit<InventoryItem, 'id' | 'createdAt'>[]) => void;
  onEditItem: (updatedItem: InventoryItem) => void;
  onDeleteItem: (itemId: string) => { ok: boolean; error?: string };
  onUpdateItemStock: (itemId: string, delta: number) => void;
  onInspectQr: (item: InventoryItem) => void;
}

interface EditableBulkRow extends BulkInventoryRowInput {
  rowId: string;
}

function createEmptyBulkRow(index = 0): EditableBulkRow {
  return {
    rowId: `row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    category: '',
    totalStock: '1',
    location: '',
    condition: 'Baik',
    customQr: '',
    description: '',
    imageUrl: '',
  };
}

/**
 * Reads an uploaded image file and compresses/resizes raster images via Canvas
 * so physical item photos stay crisp while fitting comfortably in localStorage.
 */
function readAndCompressImageFile(
  file: File,
  maxDimension = 800,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = (evt) => {
      const rawDataUrl = String(evt.target?.result || '');
      if (!rawDataUrl.startsWith('data:image/')) {
        reject(new Error('Format file bukan gambar yang valid.'));
        return;
      }
      if (rawDataUrl.startsWith('data:image/svg+xml')) {
        resolve(rawDataUrl);
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
          resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
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

export const AdminInventoryView: React.FC<AdminInventoryViewProps> = ({
  items,
  onAddItem,
  onBulkAddItems,
  onEditItem,
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
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [tableActionMessage, setTableActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Edit Item Modal state
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTotalStock, setEditTotalStock] = useState('1');
  const [editLocation, setEditLocation] = useState('');
  const [editCondition, setEditCondition] = useState<
    'Baik' | 'Perlu Perawatan'
  >('Baik');
  const [editDescription, setEditDescription] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Lightbox preview modal for physical item image
  const [previewImageItem, setPreviewImageItem] = useState<{
    name: string;
    qrCode: string;
    imageUrl: string;
  } | null>(null);

  // Bulk import state (column-by-column rows instead of comma-separated text)
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [bulkRows, setBulkRows] = useState<EditableBulkRow[]>(() =>
    SAMPLE_BULK_TEMPLATE_ROWS.map((r, idx) => ({
      ...r,
      rowId: `sample-init-${idx}`,
    }))
  );
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  const [bulkSuccessMessage, setBulkSuccessMessage] = useState<string | null>(
    null
  );

  // Table filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const previewQrCode = useMemo(() => {
    if (customQr.trim()) return customQr.trim().toUpperCase();
    const existingSet = new Set(items.map((i) => i.qrCode.toLowerCase()));
    let seq = items.length + 1;
    let candidate = generateQrCodeString(
      name || 'BARANG',
      category || 'INV',
      seq
    );
    while (existingSet.has(candidate.toLowerCase())) {
      seq++;
      candidate = generateQrCodeString(
        name || 'BARANG',
        category || 'INV',
        seq
      );
    }
    return candidate;
  }, [name, category, customQr, items]);

  const parsedBulkPreview = useMemo(
    () =>
      validateBulkInventoryRows(
        bulkRows,
        items.length,
        items.map((i) => i.qrCode)
      ),
    [bulkRows, items]
  );

  const categories = useMemo(() => {
    const set = new Set<string>(items.map((i) => i.category));
    return ['ALL', ...Array.from(set)];
  }, [items]);

  const filteredItems = useMemo(() => {
    const matched = items.filter((item) => {
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.qrCode.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });

    return [...matched].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [items, selectedCategory, searchQuery, sortOrder]);

  const handleSingleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readAndCompressImageFile(file);
      setItemImageUrl(dataUrl);
      setFormError(null);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal memuat gambar barang.'
      );
    }
    e.target.value = '';
  };

  const handleGenerateSingleSamplePhoto = () => {
    const svgDataUrl = createSampleItemIllustrationSvg({
      name: name.trim() || 'Barang Inventaris',
      category: category.trim() || 'Umum',
    });
    setItemImageUrl(svgDataUrl);
  };

  const handleEditImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readAndCompressImageFile(file);
      setEditImageUrl(dataUrl);
      setEditError(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Gagal memuat gambar barang.'
      );
    }
    e.target.value = '';
  };

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

    const finalImage = normalizeGoogleDriveImageUrl(itemImageUrl.trim());

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
      ...(finalImage ? { imageUrl: finalImage } : {}),
    });

    setFormSuccess(
      `Barang "${cleanName}" berhasil didaftarkan dengan Kode QR ${finalQr}.`
    );
    setName('');
    setCategory('');
    setLocation('');
    setCondition('Baik');
    setCustomQr('');
    setDescription('');
    setItemImageUrl('');
    setTotalStock('1');
  };

  const handleOpenEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditTotalStock(String(item.totalStock));
    setEditLocation(item.location);
    setEditCondition(item.condition);
    setEditDescription(item.description);
    setEditImageUrl(item.imageUrl || '');
    setEditError(null);
  };

  const handleSaveEditItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setEditError(null);

    const cleanName = editName.trim();
    if (!cleanName) {
      setEditError('Nama barang wajib diisi.');
      return;
    }

    const borrowed = Math.max(
      0,
      editingItem.totalStock - editingItem.availableStock
    );
    const minTotal = Math.max(1, borrowed);
    const parsedTotal = Number.parseInt(editTotalStock, 10);
    if (Number.isNaN(parsedTotal) || parsedTotal < minTotal) {
      setEditError(
        borrowed > 0
          ? `Total stok minimal ${minTotal} unit (karena ${borrowed} unit sedang dipinjam).`
          : 'Total stok minimal 1 unit.'
      );
      return;
    }

    const finalEditImage = normalizeGoogleDriveImageUrl(editImageUrl.trim());

    onEditItem({
      ...editingItem,
      name: cleanName,
      category: editCategory.trim() || 'Umum',
      totalStock: parsedTotal,
      availableStock: Math.max(0, parsedTotal - borrowed),
      location: editLocation.trim() || 'Gudang Utama',
      condition: editCondition,
      description:
        editDescription.trim() ||
        `Unit inventaris ${cleanName} (${editCategory.trim() || 'Umum'})`,
      imageUrl: finalEditImage || undefined,
    });

    setEditingItem(null);
    setTableActionMessage({
      type: 'success',
      text: `Data barang "${cleanName}" berhasil diperbarui.`,
    });
    setTimeout(() => setTableActionMessage(null), 4000);
  };

  const handleDeleteClick = (item: InventoryItem) => {
    const res = onDeleteItem(item.id);
    if (!res.ok) {
      setTableActionMessage({
        type: 'error',
        text: res.error || 'Gagal menghapus barang.',
      });
    } else {
      setTableActionMessage({
        type: 'success',
        text: `Barang "${item.name}" (${item.qrCode}) telah dihapus.`,
      });
    }
    setTimeout(() => setTableActionMessage(null), 4500);
  };

  // Bulk row handlers
  const handleUpdateBulkRow = (
    rowId: string,
    field: keyof BulkInventoryRowInput,
    value: string
  ) => {
    const finalVal =
      field === 'imageUrl' ? normalizeGoogleDriveImageUrl(value) : value;
    setBulkRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [field]: finalVal } : r))
    );
  };

  const handleBulkRowImageUpload = async (
    rowId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readAndCompressImageFile(file);
      handleUpdateBulkRow(rowId, 'imageUrl', dataUrl);
      setBulkUploadError(null);
    } catch (err) {
      setBulkUploadError(
        err instanceof Error ? err.message : 'Gagal membaca file gambar.'
      );
    }
    e.target.value = '';
  };

  const handleAddBulkRow = () => {
    setBulkRows((prev) => [...prev, createEmptyBulkRow(prev.length + 1)]);
  };

  const handleRemoveBulkRow = (rowId: string) => {
    setBulkRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [createEmptyBulkRow(1)];
    });
  };

  const handleLoadSampleRows = () => {
    setBulkRows(
      SAMPLE_BULK_TEMPLATE_ROWS.map((r, idx) => ({
        ...r,
        rowId: `sample-${Date.now()}-${idx}`,
      }))
    );
    setBulkFileName(null);
    setBulkUploadError(null);
  };

  const handleClearBulkRows = () => {
    setBulkRows([
      createEmptyBulkRow(1),
      createEmptyBulkRow(2),
      createEmptyBulkRow(3),
    ]);
    setBulkFileName(null);
    setBulkUploadError(null);
  };

  // Handle pasting multi-column cells directly from Excel / Google Sheets into any table input
  const handleBulkTablePaste = (e: React.ClipboardEvent<HTMLTableSectionElement>) => {
    const pastedText = e.clipboardData?.getData('text/plain') || '';
    if (!pastedText.includes('\t') && !pastedText.includes('\n')) {
      return; // Normal single-cell paste
    }
    const parsedRows = parseSpreadsheetTextToRows(pastedText);
    if (parsedRows.length === 0) return;

    e.preventDefault();
    setBulkRows(
      parsedRows.map((r, idx) => ({
        ...r,
        rowId: `paste-${Date.now()}-${idx}`,
      }))
    );
    setBulkFileName('Data ditempel dari Spreadsheet / Excel');
    setBulkUploadError(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    setBulkUploadError(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const isZipXlsx =
        file.name.toLowerCase().endsWith('.xlsx') ||
        (bytes.length > 4 &&
          bytes[0] === 0x50 &&
          bytes[1] === 0x4b &&
          bytes[2] === 0x03 &&
          bytes[3] === 0x04);

      if (isZipXlsx) {
        const rows = await parseInventoryExcelXlsx(bytes);
        if (rows.length === 0) {
          setBulkUploadError(
            'File Excel (.xlsx) tidak berisi baris data barang.'
          );
        } else {
          setBulkRows(
            rows.map((r, idx) => ({
              ...r,
              rowId: `xlsx-${Date.now()}-${idx}`,
            }))
          );
        }
      } else {
        const text = new TextDecoder('utf-8').decode(bytes);
        const rows = parseSpreadsheetTextToRows(text);
        if (rows.length === 0) {
          setBulkUploadError(
            'File tidak berisi baris data barang yang valid.'
          );
        } else {
          setBulkRows(
            rows.map((r, idx) => ({
              ...r,
              rowId: `csv-${Date.now()}-${idx}`,
            }))
          );
        }
      }
    } catch (err) {
      setBulkUploadError(
        err instanceof Error
          ? err.message
          : 'Gagal membaca file template. Pastikan format .xlsx atau .csv sesuai.'
      );
    }
    e.target.value = '';
  };

  const handleDownloadExcelTemplate = () => {
    const xlsxBytes = buildInventoryExcelTemplateXlsx(
      SAMPLE_BULK_TEMPLATE_ROWS
    );
    const blob = new Blob([xlsxBytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Template-Import-Inventaris.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsvTemplate = () => {
    const bom = '\uFEFF';
    const blob = new Blob([bom + SAMPLE_BULK_CSV_TEMPLATE], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Template-Import-Inventaris-Kolom.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmBulkImport = () => {
    if (parsedBulkPreview.items.length === 0) return;
    const importedCount = parsedBulkPreview.items.length;
    onBulkAddItems(parsedBulkPreview.items);
    setBulkRows([
      createEmptyBulkRow(1),
      createEmptyBulkRow(2),
      createEmptyBulkRow(3),
    ]);
    setBulkFileName(null);
    setBulkUploadError(null);
    setBulkSuccessMessage(
      `${importedCount} barang baru berhasil diimpor beserta gambar fisik dan Kode QR otomatis.`
    );
    setTimeout(() => setBulkSuccessMessage(null), 5000);
  };

  const handleBulkDownloadQrPng = (targetList: InventoryItem[]) => {
    if (targetList.length === 0) {
      setTableActionMessage({
        type: 'error',
        text: 'Belum ada data barang untuk diunduh Kode QR-nya.',
      });
      setTimeout(() => setTableActionMessage(null), 4000);
      return;
    }
    const count = downloadBulkItemsQrPng(targetList);
    setTableActionMessage({
      type: 'success',
      text: `Berhasil mengunduh ${count} gambar QR Barang dalam format .PNG (hanya berisi QR & Nama Barang)!`,
    });
    setTimeout(() => setTableActionMessage(null), 5000);
  };

  return (
    <div className="space-y-8">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Manajemen Inventaris, Foto Fisik & Generator Kode QR
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Daftarkan barang baru beserta foto fisik barang & Kode QR otomatis, atau gunakan Template Import berbasis kolom terpisah
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => handleBulkDownloadQrPng(items)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
            title="Unduh semua Kode QR barang dalam format PNG (hanya berisi QR dan Nama Barang)"
          >
            <Download className="w-4 h-4 text-[#e71f69]" />
            Bulk Download Semua QR (.PNG) ({items.length})
          </button>

          <button
            type="button"
            onClick={() => setShowBulkPanel((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            {showBulkPanel
              ? 'Tutup Panel Import Kolom / Excel'
              : 'Bulk Import Barang (Template Kolom / Excel)'}
          </button>
        </div>
      </div>

      {/* Bulk Import Excel / Column-by-Column Panel */}
      {showBulkPanel && (
        <section
          aria-label="Bulk Import Daftar Barang Berbasis Kolom"
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Template & Tabel Import Inventaris Barang (Kolom Terpisah + Gambar Fisik)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Setiap data diisi pada <strong>kolom masing-masing</strong> (tanpa pemisah koma). Anda dapat mengunduh Template Excel (<code>.xlsx</code>), mengisi kolom di Excel lalu mengunggahnya, atau mengisi langsung pada tabel kolom di bawah beserta foto fisik barang.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadExcelTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh Template Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={handleDownloadCsvTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Template CSV (Kolom Excel)
              </button>
              <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                Unggah File Excel / Template (.xlsx, .csv)
                <input
                  id="bulk-file-input"
                  name="bulkFile"
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {/* Toolbar for Table Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddBulkRow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Baris Kolom
              </button>
              <button
                type="button"
                onClick={handleLoadSampleRows}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Isi Contoh Data
              </button>
              <button
                type="button"
                onClick={handleClearBulkRows}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"
              >
                Kosongkan Baris
              </button>
            </div>

            <div className="text-xs text-slate-500">
              Tips: Anda juga dapat menyalin (Copy) sel langsung dari Excel lalu tempel (<strong>Ctrl+V / Cmd+V</strong>) pada kolom tabel di bawah.
            </div>
          </div>

          {/* Google Drive Photo Link Guide Callout */}
          <div className="p-4 bg-sky-50/80 border border-sky-200 rounded-lg text-xs text-sky-950 space-y-2">
            <div className="font-semibold flex items-center gap-2 text-sky-900">
              <Sparkles className="w-4 h-4 text-[#e71f69]" />
              <span>Cara Menggunakan Foto Barang dari Google Drive di Template Excel (Bulk Import):</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sky-900 leading-relaxed pl-1">
              <li>Upload foto fisik barang Anda ke <strong>Google Drive</strong>.</li>
              <li>Klik kanan foto di Google Drive &rarr; pilih <strong>Bagikan (Share)</strong> &rarr; pada <em>Akses Umum</em>, ubah menjadi <strong>Siapa saja yang memiliki link (Anyone with the link)</strong>.</li>
              <li>Klik <strong>Salin Link (Copy link)</strong>.</li>
              <li>Tempel (Paste) link tersebut ke <strong>Kolom H (Gambar Barang)</strong> di file Excel atau pada kolom tabel di bawah.</li>
            </ol>
            <p className="text-[11px] text-sky-700 italic">
              * Sistem ODipinjam secara otomatis mengonversi link sharing Google Drive menjadi gambar langsung yang tampil di dasbor, modal bukti foto, dan kartu label QR.
            </p>
          </div>

          {bulkFileName && (
            <p className="text-xs text-sky-700 font-medium bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
              Sumber data dimuat ke dalam kolom: <strong>{bulkFileName}</strong>
            </p>
          )}

          {bulkUploadError && (
            <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {bulkUploadError}
            </p>
          )}

          {/* Column-by-Column Editable Spreadsheet Grid */}
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[1080px]">
              <thead>
                <tr className="bg-slate-900 text-white font-medium">
                  <th className="py-2.5 px-2.5 w-10 text-center">No</th>
                  <th className="py-2.5 px-3 w-52">Gambar Fisik Barang</th>
                  <th className="py-2.5 px-3 w-48">Nama Barang *</th>
                  <th className="py-2.5 px-3 w-32">Kategori</th>
                  <th className="py-2.5 px-3 w-24">Total Stok *</th>
                  <th className="py-2.5 px-3 w-36">Lokasi</th>
                  <th className="py-2.5 px-3 w-36">Kondisi</th>
                  <th className="py-2.5 px-3 w-36">Kode QR (Opsional)</th>
                  <th className="py-2.5 px-3">Deskripsi / Spesifikasi</th>
                  <th className="py-2.5 px-2.5 w-10 text-center">Hapus</th>
                </tr>
              </thead>
              <tbody
                onPaste={handleBulkTablePaste}
                className="divide-y divide-slate-200 bg-white"
              >
                {bulkRows.map((row, idx) => {
                  const autoQrPreview = generateQrCodeString(
                    row.name || 'BARANG',
                    row.category || 'UMU',
                    items.length + idx + 1
                  );
                  return (
                    <tr key={row.rowId} className="hover:bg-slate-50/70 align-top">
                      <td className="py-2.5 px-2.5 text-center font-mono text-slate-500 pt-4">
                        {idx + 1}
                      </td>

                      {/* Kolom Gambar Fisik Barang */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-start gap-2">
                          {row.imageUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImageItem({
                                  name: row.name || `Baris ${idx + 1}`,
                                  qrCode: row.customQr || autoQrPreview,
                                  imageUrl: row.imageUrl || '',
                                })
                              }
                              title="Klik untuk memperbesar gambar"
                              className="w-11 h-11 rounded-lg border border-slate-200 overflow-hidden shrink-0 bg-slate-100 relative group"
                            >
                              <img
                                src={normalizeGoogleDriveImageUrl(row.imageUrl)}
                                alt={row.name || 'Pratinjau barang'}
                                referrerPolicy="no-referrer"
                                onError={(e) =>
                                  handleDriveImageError(e, row.imageUrl, row.name)
                                }
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="w-11 h-11 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center shrink-0 text-slate-400">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-1">
                              <label className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded cursor-pointer transition-colors whitespace-nowrap">
                                <Upload className="w-3 h-3" />
                                Pilih Foto
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) =>
                                    handleBulkRowImageUpload(row.rowId, e)
                                  }
                                  className="sr-only"
                                />
                              </label>
                              {row.imageUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateBulkRow(row.rowId, 'imageUrl', '')
                                  }
                                  aria-label="Hapus gambar baris ini"
                                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              value={
                                row.imageUrl?.startsWith('data:image/')
                                  ? ''
                                  : row.imageUrl || ''
                              }
                              onChange={(e) =>
                                handleUpdateBulkRow(
                                  row.rowId,
                                  'imageUrl',
                                  e.target.value
                                )
                              }
                              placeholder={
                                row.imageUrl?.startsWith('data:image/')
                                  ? 'File foto terlampir'
                                  : 'Tempel link Google Drive atau URL foto...'
                              }
                              aria-label={`URL Gambar baris ${idx + 1}`}
                              className="w-full px-2 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-sky-600"
                            />
                          </div>
                        </div>
                      </td>

                      {/* Kolom Nama Barang */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) =>
                            handleUpdateBulkRow(row.rowId, 'name', e.target.value)
                          }
                          placeholder="Nama barang..."
                          aria-label={`Nama Barang baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Kolom Kategori */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="text"
                          value={row.category}
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'category',
                              e.target.value
                            )
                          }
                          placeholder="Umum / Audio..."
                          aria-label={`Kategori baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Kolom Total Stok */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="number"
                          min={1}
                          value={row.totalStock}
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'totalStock',
                              e.target.value
                            )
                          }
                          aria-label={`Total Stok baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Kolom Lokasi */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="text"
                          value={row.location}
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'location',
                              e.target.value
                            )
                          }
                          placeholder="Lemari A-01"
                          aria-label={`Lokasi baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Kolom Kondisi */}
                      <td className="py-2.5 px-2.5">
                        <select
                          value={
                            String(row.condition)
                              .toLowerCase()
                              .includes('rawat')
                              ? 'Perlu Perawatan'
                              : 'Baik'
                          }
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'condition',
                              e.target.value
                            )
                          }
                          aria-label={`Kondisi baris ${idx + 1}`}
                          className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        >
                          <option value="Baik">Baik</option>
                          <option value="Perlu Perawatan">Perlu Perawatan</option>
                        </select>
                      </td>

                      {/* Kolom Kode QR */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="text"
                          value={row.customQr || ''}
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'customQr',
                              e.target.value
                            )
                          }
                          placeholder={autoQrPreview}
                          aria-label={`Kode QR baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Kolom Deskripsi */}
                      <td className="py-2.5 px-2.5">
                        <input
                          type="text"
                          value={row.description || ''}
                          onChange={(e) =>
                            handleUpdateBulkRow(
                              row.rowId,
                              'description',
                              e.target.value
                            )
                          }
                          placeholder="Kelengkapan / spesifikasi..."
                          aria-label={`Deskripsi baris ${idx + 1}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-sky-600"
                        />
                      </td>

                      {/* Hapus Baris */}
                      <td className="py-2.5 px-2.5 text-center pt-3">
                        <button
                          type="button"
                          onClick={() => handleRemoveBulkRow(row.rowId)}
                          aria-label={`Hapus baris ${idx + 1}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {parsedBulkPreview.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
              {parsedBulkPreview.errors.map((err, idx) => (
                <p key={idx} className="text-xs text-red-600 font-medium">
                  {err}
                </p>
              ))}
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {bulkSuccessMessage ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                {bulkSuccessMessage}
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                Siap mengimpor{' '}
                <strong className="font-mono text-slate-900">
                  {parsedBulkPreview.items.length}
                </strong>{' '}
                baris barang valid. Kode QR dibuat otomatis apabila kolom Kode QR dikosongkan.
              </span>
            )}
            <button
              type="button"
              disabled={parsedBulkPreview.items.length === 0}
              onClick={handleConfirmBulkImport}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Impor {parsedBulkPreview.items.length} Barang Sekarang
            </button>
          </div>
        </section>
      )}

      {/* Single Item Registration + Physical Image Input + Live QR Generator */}
      <section
        aria-label="Form Pendaftaran Barang Baru & Kode QR"
        className="bg-white border border-slate-200 rounded-lg p-6"
      >
        <h3 className="text-sm font-semibold text-slate-900 pb-4 border-b border-slate-200">
          Daftarkan Barang Baru, Gambar Fisik & Generate Kode QR
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
                Nama Barang Inventaris *
              </label>
              <input
                id="item-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Kamera Mirrorless Sony A7 IV / Proyektor Epson"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
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
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
              />
            </div>

            {/* Physical Item Image Upload & URL Input */}
            <div className="sm:col-span-2 p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="item-image-url-input"
                  className="block text-xs font-medium text-slate-700"
                >
                  Gambar Fisik Barang (Unggah Foto atau Masukkan URL Gambar)
                </label>
                {itemImageUrl && (
                  <button
                    type="button"
                    onClick={() => setItemImageUrl('')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    <X className="w-3.5 h-3.5" />
                    Hapus Gambar
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-sky-700 bg-white hover:bg-sky-50 border border-sky-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  Unggah File Foto Barang
                  <input
                    id="item-image-file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleSingleImageUpload}
                    className="sr-only"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleGenerateSingleSamplePhoto}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Ilustrasi Otomatis
                </button>

                <input
                  id="item-image-url-input"
                  type="text"
                  value={
                    itemImageUrl.startsWith('data:image/') ? '' : itemImageUrl
                  }
                  onChange={(e) => setItemImageUrl(e.target.value)}
                  placeholder={
                    itemImageUrl.startsWith('data:image/')
                      ? 'File foto fisik barang telah dilampirkan'
                      : 'Atau tempel link Google Drive / URL gambar (https://...)'
                  }
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                />
              </div>

              {itemImageUrl && (
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={itemImageUrl}
                    alt="Pratinjau gambar fisik barang"
                    referrerPolicy="no-referrer"
                    className="w-20 h-14 object-cover rounded-lg border border-slate-200 bg-white"
                  />
                  <span className="text-xs text-emerald-700 font-medium">
                    Gambar fisik barang siap disimpan ke katalog inventaris.
                  </span>
                </div>
              )}
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
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <QrCode className="w-4 h-4" />
                Simpan Barang & Generate Kode QR
              </button>
            </div>
          </div>

          {/* Live QR & Physical Image Preview Panel */}
          <div className="lg:col-span-4 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-slate-500 mb-2">
              Pratinjau Langsung Barang & Kode QR
            </span>
            {itemImageUrl && (
              <div className="w-full h-32 mb-3 rounded-lg overflow-hidden border border-slate-200 bg-white">
                <img
                  src={itemImageUrl}
                  alt="Pratinjau fisik barang"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
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
              Daftar Inventaris, Gambar Fisik & Kode QR ({filteredItems.length}{' '}
              barang)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Klik foto barang untuk memperbesar, Edit untuk mengganti foto fisik, atau Cetak QR untuk mengunduh label QR
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="inventory-search-input"
                name="inventorySearch"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama atau kode QR..."
                aria-label="Cari inventaris"
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600 w-52"
              />
            </div>

            <button
              type="button"
              disabled={filteredItems.length === 0}
              onClick={() => handleBulkDownloadQrPng(filteredItems)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
              title="Download semua QR pada daftar ini dalam format PNG (hanya QR & Nama)"
            >
              <Download className="w-3.5 h-3.5 text-[#e71f69]" />
              Bulk Download QR (.PNG) ({filteredItems.length})
            </button>

            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="Urutkan berdasarkan Nama Barang"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-[#0d113a]" />
              Urutkan Nama ({sortOrder === 'asc' ? 'A–Z' : 'Z–A'})
            </button>

            <select
              id="inventory-category-select"
              name="inventoryCategory"
              aria-label="Filter kategori inventaris"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-sky-600"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'ALL' ? 'Semua Kategori' : cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {tableActionMessage && (
          <div
            className={`px-5 py-3 text-xs font-medium border-b ${
              tableActionMessage.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            {tableActionMessage.text}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() =>
                      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                    }
                    className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
                  >
                    Nama Barang
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Lokasi</th>
                <th className="py-3 px-4 text-right">Tersedia</th>
                <th className="py-3 px-4 text-right">Jumlah Unit</th>
                <th className="py-3 px-4">Status Ketersediaan</th>
                <th className="py-3 px-4 text-center">Lihat Foto QR</th>
                <th className="py-3 px-4 text-center">Lihat Foto</th>
                <th className="py-3 px-4">Deskripsi</th>
                <th className="py-3 px-4 text-right">Kelola</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    Belum ada barang di dalam daftar inventaris. Silakan daftarkan barang di atas atau gunakan fitur Bulk Import Template Excel/Kolom.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const borrowedCount = item.totalStock - item.availableStock;
                  const isEmpty = item.availableStock === 0;
                  const normalizedImg = item.imageUrl
                    ? normalizeGoogleDriveImageUrl(item.imageUrl)
                    : '';
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {normalizedImg ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImageItem({
                                  name: item.name,
                                  qrCode: item.qrCode,
                                  imageUrl: item.imageUrl!,
                                })
                              }
                              title="Klik untuk melihat foto fisik barang"
                              className="w-11 h-11 rounded-lg border border-slate-200 overflow-hidden shrink-0 bg-slate-100 hover:opacity-90 transition-opacity"
                            >
                              <img
                                src={normalizedImg}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                onError={(e) =>
                                  handleDriveImageError(e, item.imageUrl, item.name)
                                }
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(item)}
                              title="Klik untuk menambahkan foto fisik barang"
                              className="w-11 h-11 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 flex flex-col items-center justify-center shrink-0 text-slate-400 transition-colors"
                            >
                              <ImageIcon className="w-4 h-4" />
                              <span className="text-[9px] mt-0.5">+ Foto</span>
                            </button>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">
                              {item.name}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 mt-0.5">
                              {item.qrCode} ·{' '}
                              <span
                                className={
                                  item.condition === 'Baik'
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                                }
                              >
                                {item.condition}
                              </span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {item.location}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {item.availableStock}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
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
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onInspectQr(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            Lihat Foto QR
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadSingleItemQrPng(item)}
                            title={`Unduh PNG QR & Nama (${item.name})`}
                            aria-label={`Unduh PNG QR ${item.name}`}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            <Download className="w-3.5 h-3.5 text-[#e71f69]" />
                            PNG
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {normalizedImg ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImageItem({
                                name: item.name,
                                qrCode: item.qrCode,
                                imageUrl: item.imageUrl!,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#0d113a] bg-[#0d113a]/10 hover:bg-[#0d113a]/15 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-[#e71f69]" />
                            Lihat Foto
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            + Tambah Foto
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs">
                        <p className="line-clamp-2" title={item.description}>
                          {item.description || '-'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={
                              item.availableStock <= 0 || item.totalStock <= 1
                            }
                            onClick={() => onUpdateItemStock(item.id, -1)}
                            aria-label={`Kurangi stok ${item.name}`}
                            className="px-2 py-1 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded transition-colors"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateItemStock(item.id, 1)}
                            aria-label={`Tambah stok ${item.name}`}
                            className="px-2 py-1 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            aria-label={`Edit ${item.name}`}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(item)}
                            aria-label={`Hapus ${item.name}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* Edit Item Modal */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-item-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3
                  id="edit-item-modal-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Edit Data & Foto Fisik Barang ({editingItem.qrCode})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Perbarui informasi barang, gambar fisik, kondisi, lokasi, atau total stok
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                aria-label="Tutup modal edit barang"
                className="p-1 text-slate-400 hover:text-slate-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditItem} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="edit-item-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Nama Barang *
                </label>
                <input
                  id="edit-item-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="edit-item-category"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Kategori
                  </label>
                  <input
                    id="edit-item-category"
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-item-stock"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Total Stok *
                  </label>
                  <input
                    id="edit-item-stock"
                    type="number"
                    min={Math.max(
                      1,
                      editingItem.totalStock - editingItem.availableStock
                    )}
                    value={editTotalStock}
                    onChange={(e) => setEditTotalStock(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-item-location"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Lokasi Penyimpanan
                  </label>
                  <input
                    id="edit-item-location"
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-item-condition"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Kondisi Fisik
                  </label>
                  <select
                    id="edit-item-condition"
                    value={editCondition}
                    onChange={(e) =>
                      setEditCondition(
                        e.target.value as 'Baik' | 'Perlu Perawatan'
                      )
                    }
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                  >
                    <option value="Baik">Baik (Siap Pakai)</option>
                    <option value="Perlu Perawatan">Perlu Perawatan</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-item-desc"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Spesifikasi / Kelengkapan
                </label>
                <input
                  id="edit-item-desc"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                />
              </div>

              {/* Edit Physical Image */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="edit-item-image-url"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Gambar Fisik Barang
                  </label>
                  {editImageUrl && (
                    <button
                      type="button"
                      onClick={() => setEditImageUrl('')}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Hapus Gambar
                    </button>
                  )}
                </div>

                {editImageUrl && (
                  <div className="w-full h-36 rounded-lg overflow-hidden border border-slate-200 bg-white">
                    <img
                      src={normalizeGoogleDriveImageUrl(editImageUrl)}
                      alt={editName}
                      referrerPolicy="no-referrer"
                      onError={(e) =>
                        handleDriveImageError(e, editImageUrl, editName)
                      }
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-700 bg-white hover:bg-sky-50 border border-sky-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    Unggah Foto Baru
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleEditImageUpload}
                      className="sr-only"
                    />
                  </label>
                  <input
                    id="edit-item-image-url"
                    type="text"
                    value={
                      editImageUrl.startsWith('data:image/') ? '' : editImageUrl
                    }
                    onChange={(e) => setEditImageUrl(e.target.value)}
                    placeholder={
                      editImageUrl.startsWith('data:image/')
                        ? 'File foto terlampir'
                        : 'Atau tempel link Google Drive / URL gambar (https://...)'
                    }
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
                  />
                </div>
              </div>

              {editError && (
                <p className="text-xs font-medium text-red-600">{editError}</p>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Physical Item Image Lightbox Modal */}
      {previewImageItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pratinjau Gambar Fisik Barang"
          onClick={() => setPreviewImageItem(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {previewImageItem.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">
                  {previewImageItem.qrCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImageItem(null)}
                aria-label="Tutup pratinjau gambar"
                className="p-1 text-slate-400 hover:text-slate-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100 max-h-96 flex items-center justify-center min-h-[240px]">
              <img
                src={normalizeGoogleDriveImageUrl(previewImageItem.imageUrl)}
                alt={previewImageItem.name}
                referrerPolicy="no-referrer"
                onError={(e) =>
                  handleDriveImageError(
                    e,
                    previewImageItem.imageUrl,
                    previewImageItem.name
                  )
                }
                className="w-full max-h-96 object-contain"
              />
            </div>
            {previewImageItem.imageUrl.startsWith('http') && (
              <div className="flex justify-end pt-1">
                <a
                  href={previewImageItem.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#e71f69] hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Sumber Gambar Asli
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
