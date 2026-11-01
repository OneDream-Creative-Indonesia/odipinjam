import React, { useMemo } from 'react';
import { generateQrMatrix } from '../utils/inventoryLogic';
import { InventoryItem } from '../types/inventory';
import { Copy, Check, Printer, QrCode, X } from 'lucide-react';

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

  const handleDownloadSvg = () => {
    const matrix = generateQrMatrix(item.qrCode, 21);
    const n = matrix.length;
    const q = 4;
    const total = n + q * 2;
    let rects = '';
    matrix.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell) {
          rects += `<rect x="${c + q}" y="${r + q}" width="1" height="1" fill="#0f172a"/>`;
        }
      });
    });

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="440" viewBox="0 0 360 440">
      <rect width="360" height="440" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
      <text x="180" y="38" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0284c7">LABEL INVENTARIS ODIPINJAM</text>
      <svg x="60" y="54" width="240" height="240" viewBox="0 0 ${total} ${total}">
        <rect width="${total}" height="${total}" fill="#ffffff"/>
        ${rects}
      </svg>
      <text x="180" y="324" text-anchor="middle" font-family="monospace" font-size="18" font-weight="bold" fill="#0f172a">${item.qrCode}</text>
      <text x="180" y="352" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#1e293b">${item.name.slice(0, 34)}</text>
      <text x="180" y="378" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#64748b">${item.category} · ${item.location}</text>
    </svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Label-QR-${item.qrCode}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
              Label Kode QR Inventaris
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

        <div className="my-5 p-5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-3">
            <img src="/logo-icon.svg" alt="ODipinjam" className="w-5 h-5 object-contain" />
            <span className="text-xs font-semibold text-[#0d113a]">
              ODipinjam · Kartu Pelacakan Aset
            </span>
          </div>
          {item.imageUrl && (
            <div className="w-28 h-20 mb-3 rounded-lg overflow-hidden border border-slate-200 bg-white">
              <img
                src={item.imageUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <QrCodeSvg value={item.qrCode} size={180} className="shadow-xs" />
          <p className="mt-4 font-mono text-base font-semibold text-slate-900 tabular-nums">
            {item.qrCode}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{item.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {item.category} · {item.location} · Stok: {item.availableStock}/{item.totalStock}
          </p>
        </div>

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
            onClick={handleDownloadSvg}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" />
            Unduh Label QR (.SVG)
          </button>
        </div>
      </div>
    </div>
  );
};
