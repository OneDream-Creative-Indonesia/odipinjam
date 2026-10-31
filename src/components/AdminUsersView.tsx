import React, { useState } from 'react';
import { LoanRecord, User, UserRole } from '../types/inventory';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';

interface AdminUsersViewProps {
  users: User[];
  loans: LoanRecord[];
  currentUserId: string;
  onRegisterUser: (newUser: Omit<User, 'id' | 'createdAt'>) => void;
  onToggleUserActive: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({
  users,
  loans,
  currentUserId,
  onRegisterUser,
  onToggleUserActive,
  onDeleteUser,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('anggota');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) {
      setFormError('Nama lengkap anggota wajib diisi.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFormError('Alamat email anggota tidak valid.');
      return;
    }
    if (!password || password.length < 6) {
      setFormError('Password minimal terdiri dari 6 karakter.');
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      setFormError(`Email "${cleanEmail}" sudah terdaftar pada sistem.`);
      return;
    }

    onRegisterUser({
      name: cleanName,
      email: cleanEmail,
      password,
      role,
      department: department.trim() || 'Anggota Umum',
      phone: phone.trim() || '-',
      active: true,
    });

    setFormSuccess(
      `Akun ${role === 'admin' ? 'Admin' : 'Anggota'} "${cleanName}" (${cleanEmail}) berhasil didaftarkan.`
    );
    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
  };

  const togglePasswordVisibility = (id: string) => {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Kelola Anggota
        </h2>
      </div>

      {/* Registration Form */}
      <section
        aria-label="Form Pendaftaran Anggota Baru"
        className="bg-white border border-slate-200 rounded-lg p-6"
      >
        <div className="flex items-center gap-2 pb-4 border-b border-slate-200">
          <UserPlus className="w-4 h-4 text-[#0d113a]" />
          <h3 className="text-sm font-semibold text-slate-900">
            Daftarkan Anggota (Email & Password)
          </h3>
        </div>

        <form
          onSubmit={handleRegister}
          className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <div>
            <label
              htmlFor="member-name-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Nama Lengkap *
            </label>
            <input
              id="member-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}

              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            />
          </div>

          <div>
            <label
              htmlFor="member-email-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Email*
            </label>
            <input
              id="member-email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}

              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            />
          </div>

          <div>
            <label
              htmlFor="member-password-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Password Login * (Min. 6 karakter)
            </label>
            <input
              id="member-password-input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contoh: anggota123"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            />
          </div>

          <div>
            <label
              htmlFor="member-role-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Peran Pengguna (Role)
            </label>
            <select
              id="member-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0d113a] focus:ring-1 focus:ring-[#0d113a]"
            >
              <option value="anggota">Anggota (Peminjam Barang)</option>
              <option value="admin">Admin (Pengelola Penuh)</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="member-role-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >-
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#0d113a] hover:bg-[#151c54] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              <UserPlus className="w-4 h-4" />
              Daftarkan
            </button>
          </div>

          {formError && (
            <div className="sm:col-span-2 lg:col-span-3 text-xs font-medium text-red-600">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="sm:col-span-2 lg:col-span-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              {formSuccess}
            </div>
          )}


        </form>
      </section>

      {/* Registered Users Table */}
      <section
        aria-label="Daftar Pengguna Terdaftar"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Direktori Akun Pengguna ({users.length} akun terdaftar)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Anggota dapat login menggunakan email dan password yang terdaftar di bawah ini
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Nama & Departemen</th>
                <th className="py-3 px-4">Email Login</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-4">Peran</th>
                <th className="py-3 px-4 text-right">Peminjaman Aktif</th>
                <th className="py-3 px-4">Status Akun</th>
                <th className="py-3 px-4 text-right">Tindakan Admin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {users.map((u) => {
                const activeCount = loans.filter(
                  (l) => l.userId === u.id && l.status === 'dipinjam'
                ).length;
                const isSelf = u.id === currentUserId;
                const isPassShown = !!showPasswords[u.id];

                return (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{u.name}</p>
                      <p className="text-slate-500 mt-0.5">
                        {u.department} · {u.phone}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-800">
                      {u.email}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <span>
                          {isPassShown ? u.password : '••••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(u.id)}
                          aria-label={
                            isPassShown
                              ? `Sembunyikan password ${u.name}`
                              : `Lihat password ${u.name}`
                          }
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {isPassShown ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#e71f69]">
                          <Shield className="w-3.5 h-3.5" />
                          Admin
                        </span>
                      ) : (
                        <span className="text-slate-700 font-medium">
                          Anggota
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {activeCount}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {u.active ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <UserCheck className="w-3.5 h-3.5" />
                          Aktif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                          <UserX className="w-3.5 h-3.5" />
                          Nonaktif
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {!isSelf ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onToggleUserActive(u.id)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                          >
                            {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteUser(u.id)}
                            aria-label={`Hapus pengguna ${u.name}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">Sesi Anda</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
