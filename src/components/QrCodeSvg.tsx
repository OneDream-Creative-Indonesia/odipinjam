import React, { useMemo } from 'react';
import { generateQrMatrix } from '../utils/inventoryLogic';
import { downloadSingleItemQrPng } from '../utils/qrPngDownload';
import { InventoryItem } from '../types/inventory';
import { Copy, Check, Download, QrCode, X } from 'lucide-react';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  className?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 120,
  className = '',
}) => {
  const matrix = useMemo(() => generateQrMatrix(value, 21), [value]);
  const n = matrix.length;
  const quietZone = 4;
  const totalModules = n + quietZone * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${totalModules} ${totalModules}`}
      className={`bg-white border border-slate-200 rounded ${className}`}
      role="img"
      aria-label={`Kode QR ${value}`}
    >
      <rect width={totalModules} height={totalModules} fill="#ffffff" />
      {matrix.map((row, rIdx) =>
        row.map((cell, cIdx) =>
          cell ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx + quietZone}
              y={rIdx + quietZone}
              width={1}
              height={1}
              fill="#0f172a"
            />
          ) : null
        )
      )}
    </svg>
  );
};

interface QrLabelModalProps {
  item: InventoryItem | null;
  onClose: () => void;
}

export const QrLabelModal: React.FC<QrLabelModalProps> = ({ item, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!item) return null;

  const handleCopy = () => {
    navigator.clipboard?.writeText(item.qrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadPng = () => {
    downloadSingleItemQrPng(item);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-[#0d113a]" />
            <h3 id="qr-modal-title" className="text-base font-semibold text-slate-900">
              Label Kode QR Barang (.PNG)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal QR"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="my-5 p-6 bg-white border border-slate-200 rounded-xl flex flex-col items-center text-center shadow-xs">
          <QrCodeSvg value={item.qrCode} size={200} className="border-0" />
          <p className="mt-3 text-base font-bold text-slate-900">{item.name}</p>
        </div>
        <p className="text-[11px] text-slate-500 text-center -mt-2 mb-4 font-mono">
          Kode QR: {item.qrCode} · Hasil unduhan format .PNG hanya berisi QR & Nama Barang
        </p>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Tersalin
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Salin Kode QR
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-[#e71f69]" />
            Unduh QR (.PNG)
          </button>
        </div>
      </div>
    </div>
  );
};
