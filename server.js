import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, 'data');
const dbFilePath = path.join(dataDir, 'odipinjam-db.json');
const smtpFilePath = path.join(dataDir, 'smtp-config.json');

app.use(express.json({ limit: '50mb' }));

// Setup MySQL Connection Pool
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'u232199593_odipinjam',
  password: process.env.DB_PASSWORD || 'Odipinjam21',
  database: process.env.DB_NAME || process.env.DB_Name || 'u232199593_odipinjam',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool = null;
let useMysql = false;

// Default SMTP configuration (can be updated from Admin UI or .env)
let smtpConfig = {
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT) || 465,
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : true,
  smtpUser: process.env.SMTP_USER || 'onedreamcreativeindonesia@gmail.com',
  smtpPass: process.env.SMTP_PASS || '',
  senderName: process.env.SMTP_SENDER_NAME || 'ODipinjam - OneDream Creative Indonesia',
  enabled: true,
};

function loadSmtpFromDisk() {
  try {
    if (fs.existsSync(smtpFilePath)) {
      const raw = fs.readFileSync(smtpFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        smtpConfig = {
          smtpHost: parsed.smtpHost || smtpConfig.smtpHost,
          smtpPort: Number(parsed.smtpPort) || smtpConfig.smtpPort,
          smtpSecure: typeof parsed.smtpSecure === 'boolean' ? parsed.smtpSecure : smtpConfig.smtpSecure,
          smtpUser: parsed.smtpUser ?? smtpConfig.smtpUser,
          smtpPass: parsed.smtpPass || smtpConfig.smtpPass,
          senderName: parsed.senderName || smtpConfig.senderName,
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to read smtp-config.json:', err.message);
  }
}

function saveSmtpToDisk(cfg) {
  smtpConfig = {
    smtpHost: String(cfg.smtpHost || 'smtp.gmail.com').trim(),
    smtpPort: Number(cfg.smtpPort) || 465,
    smtpSecure: Boolean(cfg.smtpSecure),
    smtpUser: String(cfg.smtpUser || '').trim(),
    smtpPass: String(cfg.smtpPass || '').trim(),
    senderName: String(cfg.senderName || 'ODipinjam - OneDream Creative Indonesia').trim(),
    enabled: cfg.enabled !== false,
  };
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(smtpFilePath, JSON.stringify(smtpConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to write smtp-config.json:', err.message);
  }
}

loadSmtpFromDisk();

// Fallback in-memory DB if MySQL connection fails
let memoryDb = {
  initialized: false,
  users: [],
  items: [],
  loans: [],
  emails: [],
  updatedAt: null,
};

// Track which email IDs have already been sent via SMTP in this process
const sentEmailIds = new Set();

function loadDbFromDisk() {
  try {
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        memoryDb = {
          initialized: Boolean(parsed.initialized),
          users: Array.isArray(parsed.users) ? parsed.users : [],
          items: Array.isArray(parsed.items) ? parsed.items : [],
          loans: Array.isArray(parsed.loans) ? parsed.loans : [],
          emails: Array.isArray(parsed.emails) ? parsed.emails : [],
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
        for (const em of memoryDb.emails) {
          if (em.deliveryStatus === 'sent') {
            sentEmailIds.add(em.id);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to read database file, using in-memory store:', err);
  }
}

function saveDbToDisk(nextState) {
  memoryDb = {
    initialized: true,
    users: Array.isArray(nextState.users) ? nextState.users : memoryDb.users,
    items: Array.isArray(nextState.items) ? nextState.items : memoryDb.items,
    loans: Array.isArray(nextState.loans) ? nextState.loans : memoryDb.loans,
    emails: Array.isArray(nextState.emails) ? nextState.emails : memoryDb.emails,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dbFilePath, JSON.stringify(memoryDb, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write database file to disk, kept in memory:', err);
  }
}

function buildHtmlEmailTemplate(em) {
  const badgeColor =
    em.type === 'belum_dikembalikan'
      ? '#dc2626'
      : em.type === 'batas_waktu_hampir_habis'
        ? '#d97706'
        : em.type === 'konfirmasi_pengembalian'
          ? '#059669'
          : '#0d113a';

  const badgeLabel =
    em.type === 'belum_dikembalikan'
      ? 'PERINGATAN KETERLAMBATAN PENGEMBALIAN'
      : em.type === 'batas_waktu_hampir_habis'
        ? 'PENGINGAT BATAS WAKTU PEMINJAMAN'
        : em.type === 'konfirmasi_pengembalian'
          ? 'KONFIRMASI PENGEMBALIAN BARANG'
          : 'BUKTI PEMINJAMAN BARANG';

  const safeBodyHtml = String(em.body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>${em.subject}</title>
</head>
<body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0d113a;padding:18px 24px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#e71f69;text-transform:uppercase;">
        ODipinjam · Sistem Manajemen Inventaris
      </div>
      <div style="font-size:17px;font-weight:700;margin-top:4px;">
        ${em.subject}
      </div>
    </div>
    <div style="padding:24px;">
      <div style="display:inline-block;padding:4px 10px;border-radius:6px;background:${badgeColor};color:#ffffff;font-size:11px;font-weight:700;margin-bottom:16px;">
        ${badgeLabel}
      </div>
      <div style="font-size:14px;line-height:1.65;color:#1e293b;">
        ${safeBodyHtml}
      </div>
      <div style="margin-top:20px;padding:12px 16px;background:#f1f5f9;border-radius:8px;font-size:12px;color:#475569;">
        <strong>Barang:</strong> ${em.itemName} &nbsp;|&nbsp; <strong>Kode QR:</strong> <code>${em.itemQrCode}</code>
      </div>
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;">
      Email ini dikirimkan secara otomatis oleh sistem <strong>ODipinjam (OneDream Creative Indonesia)</strong>.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dispatches an EmailNotification via Nodemailer to the recipient's real email/Gmail.
 */
async function sendRealEmailViaSmtp(em) {
  if (!smtpConfig.enabled) {
    return { sent: false, error: 'Pengiriman email SMTP sedang dinonaktifkan.' };
  }
  if (!smtpConfig.smtpUser || !smtpConfig.smtpPass) {
    return {
      sent: false,
      error:
        'App Password Gmail / Password SMTP belum diisi pada pengaturan Email Pengirim.',
    };
  }
  if (!em.recipientEmail || !em.recipientEmail.includes('@')) {
    return { sent: false, error: 'Alamat email penerima tidak valid.' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.smtpHost || 'smtp.gmail.com',
      port: Number(smtpConfig.smtpPort) || 465,
      secure: Boolean(smtpConfig.smtpSecure),
      auth: {
        user: smtpConfig.smtpUser,
        pass: smtpConfig.smtpPass.replace(/\s+/g, ''), // strip spaces in 16-char Gmail App Password
      },
    });

    const fromAddress = smtpConfig.senderName
      ? `"${smtpConfig.senderName.replace(/"/g, '')}" <${smtpConfig.smtpUser}>`
      : smtpConfig.smtpUser;

    await transporter.sendMail({
      from: fromAddress,
      to: em.recipientEmail,
      subject: em.subject,
      text: em.body,
      html: buildHtmlEmailTemplate(em),
    });

    sentEmailIds.add(em.id);
    return { sent: true };
  } catch (err) {
    console.error(`Failed to send real email to ${em.recipientEmail}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function initMysql() {
  try {
    pool = mysql.createPool(dbConfig);
    const conn = await pool.getConnection();
    console.log('✅ Connected to MySQL Database (Hostinger):', dbConfig.database);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'anggota') DEFAULT 'anggota',
        department VARCHAR(100) DEFAULT 'Umum',
        phone VARCHAR(50) DEFAULT '-',
        active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(64) PRIMARY KEY,
        qr_code VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100) DEFAULT 'Umum',
        total_stock INT UNSIGNED DEFAULT 1,
        available_stock INT UNSIGNED DEFAULT 1,
        location VARCHAR(150) DEFAULT 'Gudang Utama',
        \`condition\` ENUM('Baik', 'Perlu Perawatan') DEFAULT 'Baik',
        description TEXT,
        image_url LONGTEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id VARCHAR(64) PRIMARY KEY,
        item_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        quantity INT UNSIGNED DEFAULT 1,
        borrow_date DATETIME NOT NULL,
        due_date DATETIME NOT NULL,
        return_date DATETIME NULL,
        duration_days INT UNSIGNED DEFAULT 1,
        purpose_notes TEXT,
        return_notes TEXT NULL,
        borrow_photo_url LONGTEXT,
        return_photo_url LONGTEXT NULL,
        status ENUM('dipinjam', 'dikembalikan') DEFAULT 'dipinjam',
        reminder_sent_at DATETIME NULL,
        overdue_email_sent_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_loans_status (status),
        INDEX idx_loans_user (user_id),
        INDEX idx_loans_item (item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS email_notifications (
        id VARCHAR(64) PRIMARY KEY,
        recipient_email VARCHAR(150) NOT NULL,
        recipient_name VARCHAR(150) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        loan_id VARCHAR(64) NOT NULL,
        item_name VARCHAR(200) NOT NULL,
        item_qr_code VARCHAR(64) NOT NULL,
        type VARCHAR(64) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        sent_at DATETIME NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        delivery_status VARCHAR(32) DEFAULT 'pending',
        delivery_error TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notif_user (user_id),
        INDEX idx_notif_read (is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure delivery_status and delivery_error columns exist if table was created earlier
    try {
      await conn.query(
        `ALTER TABLE email_notifications ADD COLUMN delivery_status VARCHAR(32) DEFAULT 'pending'`
      );
    } catch {
      // column already exists
    }
    try {
      await conn.query(
        `ALTER TABLE email_notifications ADD COLUMN delivery_error TEXT NULL`
      );
    } catch {
      // column already exists
    }
    // Ensure photo and image columns use LONGTEXT so base64 photos are never truncated
    try {
      await conn.query(`ALTER TABLE inventory_items MODIFY COLUMN image_url LONGTEXT`);
      await conn.query(`ALTER TABLE loans MODIFY COLUMN borrow_photo_url LONGTEXT`);
      await conn.query(`ALTER TABLE loans MODIFY COLUMN return_photo_url LONGTEXT NULL`);
    } catch {
      // ignore if already LONGTEXT
    }
    try {
      await conn.query(`ALTER TABLE loans ADD COLUMN duration_hours INT UNSIGNED DEFAULT 0`);
    } catch {
      // ignore if already exists
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS smtp_settings (
        id INT PRIMARY KEY DEFAULT 1,
        smtp_host VARCHAR(150) DEFAULT 'smtp.gmail.com',
        smtp_port INT DEFAULT 465,
        smtp_secure BOOLEAN DEFAULT TRUE,
        smtp_user VARCHAR(150) DEFAULT 'onedreamcreativeindonesia@gmail.com',
        smtp_pass VARCHAR(255) DEFAULT '',
        sender_name VARCHAR(150) DEFAULT 'ODipinjam - OneDream Creative Indonesia',
        enabled BOOLEAN DEFAULT TRUE,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [smtpRows] = await conn.query('SELECT * FROM smtp_settings WHERE id = 1');
    if (smtpRows.length > 0) {
      const s = smtpRows[0];
      smtpConfig = {
        smtpHost: s.smtp_host || smtpConfig.smtpHost,
        smtpPort: Number(s.smtp_port) || smtpConfig.smtpPort,
        smtpSecure: Boolean(s.smtp_secure),
        smtpUser: s.smtp_user || smtpConfig.smtpUser,
        smtpPass: s.smtp_pass || smtpConfig.smtpPass,
        senderName: s.sender_name || smtpConfig.senderName,
        enabled: Boolean(s.enabled),
      };
    } else {
      await conn.query(
        `INSERT IGNORE INTO smtp_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, sender_name, enabled)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          smtpConfig.smtpHost,
          smtpConfig.smtpPort,
          smtpConfig.smtpSecure ? 1 : 0,
          smtpConfig.smtpUser,
          smtpConfig.smtpPass,
          smtpConfig.senderName,
          smtpConfig.enabled ? 1 : 0,
        ]
      );
    }

    // Ensure default master admin exists
    await conn.query(`
      INSERT IGNORE INTO users (id, name, email, password, role, department, phone, active, created_at)
      VALUES (
        'usr-admin-master',
        'Administrator Utama',
        'onedreamcreativeindonesia@gmail.com',
        'MenyatukanMIMPI21',
        'admin',
        'Manajemen Inventaris',
        '-',
        TRUE,
        NOW()
      );
    `);

    conn.release();
    useMysql = true;
    console.log('✅ MySQL Tables and Schema initialized successfully.');
  } catch (err) {
    console.warn('⚠️ Could not connect to MySQL, running with JSON fallback mode:', err.message);
    useMysql = false;
    loadDbFromDisk();
  }
}

initMysql();

// Helper to format ISO date safely
function toMysqlDatetime(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Background automatic scheduler: checks due-soon & overdue loans every 60s and sends real emails
async function runServerAutoEmailDispatcher() {
  const now = new Date();
  const nowIso = now.toISOString();

  if (useMysql && pool) {
    try {
      const [activeLoans] = await pool.query(`
        SELECT l.*, i.name as item_name, i.qr_code as item_qr_code,
               u.name as user_name, u.email as user_email, u.department as user_department
        FROM loans l
        LEFT JOIN inventory_items i ON l.item_id = i.id
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.status = 'dipinjam'
      `);

      for (const l of activeLoans) {
        if (!l.user_email) continue;
        const dueMs = new Date(l.due_date).getTime();
        const diffHours = Math.round(((dueMs - now.getTime()) / (1000 * 60 * 60)) * 10) / 10;
        const dueFormatted = new Date(l.due_date).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });

        if (diffHours < 0 && !l.overdue_email_sent_at) {
          const overdueHours = Math.abs(Math.round(diffHours));
          const days = Math.floor(overdueHours / 24);
          const label = days >= 1 ? `Terlambat ${days} hari` : `Terlambat ${Math.max(1, overdueHours)} jam`;
          const notifId = `email-ovd-${l.id}-${Date.now()}`;
          const subject = `[PERINGATAN ODipinjam] Barang Belum Dikembalikan: "${l.item_name}" (${l.item_qr_code})`;
          const body = `Yth. ${l.user_name} (${l.user_department || 'Anggota'}),\n\nBerdasarkan catatan sistem ODipinjam, barang "${l.item_name}" (Kode QR: ${l.item_qr_code}, Jumlah: ${l.quantity} unit) telah melewati batas waktu pengembalian pada ${dueFormatted} (${label}) dan tercatat BELUM DIKEMBALIKAN.\n\nMohon segera mengembalikan barang ke lokasi penyimpanan dan melakukan konfirmasi pengembalian beserta bukti foto.`;

          const smtpRes = await sendRealEmailViaSmtp({
            id: notifId,
            recipientEmail: l.user_email,
            recipientName: l.user_name,
            itemName: l.item_name,
            itemQrCode: l.item_qr_code,
            type: 'belum_dikembalikan',
            subject,
            body,
          });

          await pool.query(
            `INSERT INTO email_notifications (id, recipient_email, recipient_name, user_id, loan_id, item_name, item_qr_code, type, subject, body, sent_at, is_read, delivery_status, delivery_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'belum_dikembalikan', ?, ?, ?, 0, ?, ?)`,
            [
              notifId,
              l.user_email,
              l.user_name,
              l.user_id,
              l.id,
              l.item_name || '',
              l.item_qr_code || '',
              subject,
              body,
              toMysqlDatetime(nowIso),
              smtpRes.sent ? 'sent' : 'failed',
              smtpRes.error || null,
            ]
          );

          await pool.query(`UPDATE loans SET overdue_email_sent_at = ? WHERE id = ?`, [
            toMysqlDatetime(nowIso),
            l.id,
          ]);
        } else if (diffHours >= 0 && diffHours <= 24 && !l.reminder_sent_at) {
          const label = `Sisa ${Math.max(1, Math.ceil(diffHours))} jam`;
          const notifId = `email-rem-${l.id}-${Date.now()}`;
          const subject = `[Pengingat ODipinjam] Batas Waktu Peminjaman "${l.item_name}" Hampir Habis`;
          const body = `Halo ${l.user_name},\n\nKami mengingatkan bahwa masa peminjaman barang "${l.item_name}" (Kode QR: ${l.item_qr_code}, Jumlah: ${l.quantity} unit) akan segera berakhir pada ${dueFormatted} (${label}).\n\nKeperluan Peminjaman: ${l.purpose_notes || '-'}\n\nMohon segera menyiapkan pengembalian barang melalui portal ODipinjam dan melampirkan bukti foto kondisi barang.`;

          const smtpRes = await sendRealEmailViaSmtp({
            id: notifId,
            recipientEmail: l.user_email,
            recipientName: l.user_name,
            itemName: l.item_name,
            itemQrCode: l.item_qr_code,
            type: 'batas_waktu_hampir_habis',
            subject,
            body,
          });

          await pool.query(
            `INSERT INTO email_notifications (id, recipient_email, recipient_name, user_id, loan_id, item_name, item_qr_code, type, subject, body, sent_at, is_read, delivery_status, delivery_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'batas_waktu_hampir_habis', ?, ?, ?, 0, ?, ?)`,
            [
              notifId,
              l.user_email,
              l.user_name,
              l.user_id,
              l.id,
              l.item_name || '',
              l.item_qr_code || '',
              subject,
              body,
              toMysqlDatetime(nowIso),
              smtpRes.sent ? 'sent' : 'failed',
              smtpRes.error || null,
            ]
          );

          await pool.query(`UPDATE loans SET reminder_sent_at = ? WHERE id = ?`, [
            toMysqlDatetime(nowIso),
            l.id,
          ]);
        }
      }
    } catch (err) {
      console.warn('Auto email scheduler check error:', err.message);
    }
  }
}

setInterval(runServerAutoEmailDispatcher, 60 * 1000);

// ==========================================
// REST API ENDPOINTS
// ==========================================

// 1. GET State
app.get('/api/state', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!useMysql || !pool) {
    return res.json(memoryDb);
  }

  try {
    // Self-heal available_stock from active loans so stock is always 100% accurate
    await pool.query(`
      UPDATE inventory_items i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) AS borrowed_qty
        FROM loans
        WHERE status = 'dipinjam'
        GROUP BY item_id
      ) l ON i.id = l.item_id
      SET i.available_stock = GREATEST(0, CAST(i.total_stock AS SIGNED) - COALESCE(l.borrowed_qty, 0))
    `);

    const [userRows] = await pool.query('SELECT * FROM users');
    const [itemRows] = await pool.query('SELECT * FROM inventory_items ORDER BY created_at DESC');
    const [loanRows] = await pool.query(`
      SELECT l.*, i.name as item_name, i.qr_code as item_qr_code, i.category as item_category,
             u.name as user_name, u.email as user_email, u.department as user_department
      FROM loans l
      LEFT JOIN inventory_items i ON l.item_id = i.id
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.borrow_date DESC
    `);
    const [emailRows] = await pool.query('SELECT * FROM email_notifications ORDER BY sent_at DESC');

    const mappedUsers = userRows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
      department: u.department,
      phone: u.phone,
      createdAt: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
      active: Boolean(u.active),
    }));

    const mappedItems = itemRows.map(i => ({
      id: i.id,
      qrCode: i.qr_code,
      name: i.name,
      category: i.category,
      totalStock: Number(i.total_stock),
      availableStock: Number(i.available_stock),
      location: i.location,
      condition: i.condition,
      description: i.description || '',
      imageUrl: i.image_url || undefined,
      createdAt: i.created_at ? new Date(i.created_at).toISOString() : new Date().toISOString(),
    }));

    const mappedLoans = loanRows.map(l => ({
      id: l.id,
      itemId: l.item_id,
      itemQrCode: l.item_qr_code || '',
      itemName: l.item_name || '',
      itemCategory: l.item_category || '',
      userId: l.user_id,
      userName: l.user_name || '',
      userEmail: l.user_email || '',
      userDepartment: l.user_department || '',
      quantity: Number(l.quantity),
      borrowDate: l.borrow_date ? new Date(l.borrow_date).toISOString() : '',
      dueDate: l.due_date ? new Date(l.due_date).toISOString() : '',
      returnDate: l.return_date ? new Date(l.return_date).toISOString() : undefined,
      durationDays: Number(l.duration_days),
      durationHours: Number(l.duration_hours) || 0,
      purposeNotes: l.purpose_notes || '',
      returnNotes: l.return_notes || undefined,
      borrowPhotoDataUrl: l.borrow_photo_url || '',
      returnPhotoDataUrl: l.return_photo_url || undefined,
      status: l.status,
      reminderSentAt: l.reminder_sent_at ? new Date(l.reminder_sent_at).toISOString() : undefined,
      overdueEmailSentAt: l.overdue_email_sent_at ? new Date(l.overdue_email_sent_at).toISOString() : undefined,
    }));

    const mappedEmails = emailRows.map(e => ({
      id: e.id,
      recipientEmail: e.recipient_email,
      recipientName: e.recipient_name,
      userId: e.user_id,
      loanId: e.loan_id,
      itemName: e.item_name,
      itemQrCode: e.item_qr_code,
      type: e.type,
      subject: e.subject,
      body: e.body,
      sentAt: e.sent_at ? new Date(e.sent_at).toISOString() : '',
      read: Boolean(e.is_read),
      deliveryStatus: e.delivery_status || 'pending',
      deliveryError: e.delivery_error || undefined,
    }));

    res.json({
      initialized: true,
      users: mappedUsers,
      items: mappedItems,
      loans: mappedLoans,
      emails: mappedEmails,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error fetching state from MySQL:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// 2. POST State Sync (Syncs additions, updates, deletions, AND dispatches new emails via SMTP)
app.post('/api/state', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { users, items, loans, emails } = req.body || {};

  const incomingEmails = Array.isArray(emails) ? emails : [];

  if (!useMysql || !pool) {
    // Reconcile item availableStock from active loans in fallback memory mode
    const nextLoansList = Array.isArray(loans) ? loans : memoryDb.loans;
    const rawItemsList = Array.isArray(items) ? items : memoryDb.items;
    const reconciledItems = rawItemsList.map(it => {
      const borrowed = nextLoansList
        .filter(
          l =>
            l.status === 'dipinjam' &&
            (l.itemId === it.id ||
              (l.itemQrCode &&
                it.qrCode &&
                String(l.itemQrCode).toLowerCase() === String(it.qrCode).toLowerCase()))
        )
        .reduce((acc, l) => acc + (Number(l.quantity) || 1), 0);
      return {
        ...it,
        availableStock: Math.max(0, Math.min(Number(it.totalStock) || 1, (Number(it.totalStock) || 1) - borrowed)),
      };
    });

    saveDbToDisk({
      users,
      items: reconciledItems,
      loans: nextLoansList,
      emails: incomingEmails,
    });
    res.json({ ok: true, state: memoryDb });

    // Dispatch any newly added emails via SMTP asynchronously in background
    (async () => {
      let changed = false;
      for (const em of memoryDb.emails) {
        if (!sentEmailIds.has(em.id) && em.deliveryStatus !== 'sent') {
          const smtpRes = await sendRealEmailViaSmtp(em);
          em.deliveryStatus = smtpRes.sent ? 'sent' : 'failed';
          em.deliveryError = smtpRes.error || undefined;
          changed = true;
        }
      }
      if (changed) saveDbToDisk(memoryDb);
    })().catch(() => {});
    return;
  }

  const conn = await pool.getConnection();
  const emailsToDispatchInBackground = [];

  try {
    await conn.beginTransaction();

    // Sync Users (Upsert + Delete removed users)
    if (Array.isArray(users)) {
      if (users.length > 0) {
        const userIds = users.map(u => u.id);
        await conn.query(`DELETE FROM users WHERE id NOT IN (?)`, [userIds]);
      }
      for (const u of users) {
        await conn.query(
          `INSERT INTO users (id, name, email, password, role, department, phone, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             password = VALUES(password),
             role = VALUES(role),
             department = VALUES(department),
             phone = VALUES(phone),
             active = VALUES(active);`,
          [
            u.id,
            u.name,
            u.email,
            u.password,
            u.role || 'anggota',
            u.department || 'Umum',
            u.phone || '-',
            u.active ? 1 : 0,
            toMysqlDatetime(u.createdAt) || new Date(),
          ]
        );
      }
    }

    // Sync Items (Upsert + Delete removed items)
    if (Array.isArray(items)) {
      if (items.length > 0) {
        const itemIds = items.map(it => it.id);
        await conn.query(`DELETE FROM inventory_items WHERE id NOT IN (?)`, [itemIds]);
      } else {
        await conn.query(`DELETE FROM inventory_items`);
      }
      for (const it of items) {
        await conn.query(
          `INSERT INTO inventory_items (id, qr_code, name, category, total_stock, available_stock, location, \`condition\`, description, image_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             qr_code = VALUES(qr_code),
             name = VALUES(name),
             category = VALUES(category),
             total_stock = VALUES(total_stock),
             available_stock = VALUES(available_stock),
             location = VALUES(location),
             \`condition\` = VALUES(\`condition\`),
             description = VALUES(description),
             image_url = VALUES(image_url);`,
          [
            it.id,
            it.qrCode,
            it.name,
            it.category || 'Umum',
            Number(it.totalStock) || 1,
            Number(it.availableStock) || 0,
            it.location || 'Gudang Utama',
            it.condition || 'Baik',
            it.description || '',
            it.imageUrl || null,
            toMysqlDatetime(it.createdAt) || new Date(),
          ]
        );
      }
    }

    // Sync Loans (Upsert + Delete removed loans)
    if (Array.isArray(loans)) {
      if (loans.length > 0) {
        const loanIds = loans.map(ln => ln.id);
        await conn.query(`DELETE FROM loans WHERE id NOT IN (?)`, [loanIds]);
      } else {
        await conn.query(`DELETE FROM loans`);
      }
      for (const ln of loans) {
        await conn.query(
          `INSERT INTO loans (id, item_id, user_id, quantity, borrow_date, due_date, return_date, duration_days, duration_hours, purpose_notes, return_notes, borrow_photo_url, return_photo_url, status, reminder_sent_at, overdue_email_sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity = VALUES(quantity),
             borrow_date = VALUES(borrow_date),
             due_date = VALUES(due_date),
             duration_days = VALUES(duration_days),
             duration_hours = VALUES(duration_hours),
             purpose_notes = VALUES(purpose_notes),
             borrow_photo_url = VALUES(borrow_photo_url),
             return_date = VALUES(return_date),
             return_notes = VALUES(return_notes),
             return_photo_url = VALUES(return_photo_url),
             status = VALUES(status),
             reminder_sent_at = VALUES(reminder_sent_at),
             overdue_email_sent_at = VALUES(overdue_email_sent_at);`,
          [
            ln.id,
            ln.itemId,
            ln.userId,
            Number(ln.quantity) || 1,
            toMysqlDatetime(ln.borrowDate) || new Date(),
            toMysqlDatetime(ln.dueDate) || new Date(),
            toMysqlDatetime(ln.returnDate),
            Number(ln.durationDays) || 0,
            Number(ln.durationHours) || 0,
            ln.purposeNotes || '',
            ln.returnNotes || null,
            ln.borrowPhotoDataUrl || null,
            ln.returnPhotoDataUrl || null,
            ln.status || 'dipinjam',
            toMysqlDatetime(ln.reminderSentAt),
            toMysqlDatetime(ln.overdueEmailSentAt),
          ]
        );
      }
    }

    // Always recalculate inventory_items.available_stock directly from active loans inside the transaction
    await conn.query(`
      UPDATE inventory_items i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) AS borrowed_qty
        FROM loans
        WHERE status = 'dipinjam'
        GROUP BY item_id
      ) l ON i.id = l.item_id
      SET i.available_stock = GREATEST(0, CAST(i.total_stock AS SIGNED) - COALESCE(l.borrowed_qty, 0))
    `);

    // Save email notifications to DB quickly, and queue any unsent ones for background SMTP delivery
    if (Array.isArray(emails)) {
      const [existingEmailRows] = await conn.query(
        `SELECT id, delivery_status FROM email_notifications`
      );
      const dbSentMap = new Map(existingEmailRows.map(r => [r.id, r.delivery_status]));

      if (emails.length > 0) {
        const emailIds = emails.map(em => em.id);
        await conn.query(`DELETE FROM email_notifications WHERE id NOT IN (?)`, [emailIds]);
      } else {
        await conn.query(`DELETE FROM email_notifications`);
      }

      for (const em of emails) {
        const prevStatus = dbSentMap.get(em.id);
        const deliveryStatus = prevStatus || em.deliveryStatus || 'pending';
        const deliveryError = em.deliveryError || null;

        if (deliveryStatus !== 'sent' && !sentEmailIds.has(em.id) && !prevStatus) {
          emailsToDispatchInBackground.push(em);
        }

        await conn.query(
          `INSERT INTO email_notifications (id, recipient_email, recipient_name, user_id, loan_id, item_name, item_qr_code, type, subject, body, sent_at, is_read, delivery_status, delivery_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             is_read = VALUES(is_read),
             delivery_status = IF(delivery_status = 'sent', 'sent', VALUES(delivery_status)),
             delivery_error = IF(delivery_status = 'sent', NULL, VALUES(delivery_error));`,
          [
            em.id,
            em.recipientEmail,
            em.recipientName,
            em.userId,
            em.loanId,
            em.itemName || '',
            em.itemQrCode || '',
            em.type,
            em.subject,
            em.body,
            toMysqlDatetime(em.sentAt) || new Date(),
            em.read ? 1 : 0,
            deliveryStatus,
            deliveryError,
          ]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true, message: 'Synchronized with MySQL successfully' });
  } catch (err) {
    await conn.rollback();
    console.error('Error writing state to MySQL:', err);
    res.status(500).json({ error: 'Database transaction failed', details: err.message });
    return;
  } finally {
    conn.release();
  }

  // Dispatch newly queued SMTP emails asynchronously AFTER transaction commit
  if (emailsToDispatchInBackground.length > 0 && pool) {
    (async () => {
      for (const em of emailsToDispatchInBackground) {
        const smtpRes = await sendRealEmailViaSmtp(em);
        const status = smtpRes.sent ? 'sent' : 'failed';
        try {
          await pool.query(
            `UPDATE email_notifications SET delivery_status = ?, delivery_error = ? WHERE id = ?`,
            [status, smtpRes.error || null, em.id]
          );
        } catch (err) {
          console.warn('Failed to update background email status:', err.message);
        }
      }
    })().catch(() => {});
  }
});

// 3. Dedicated endpoint to Retry / Send a single email immediately via SMTP
app.post('/api/send-email', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.recipientEmail) {
    return res.status(400).json({ ok: false, error: 'Data email tidak lengkap.' });
  }

  const smtpRes = await sendRealEmailViaSmtp(email);
  const status = smtpRes.sent ? 'sent' : 'failed';

  if (useMysql && pool) {
    try {
      await pool.query(
        `UPDATE email_notifications SET delivery_status = ?, delivery_error = ? WHERE id = ?`,
        [status, smtpRes.error || null, email.id]
      );
    } catch (err) {
      console.warn('Failed to update email delivery status in MySQL:', err.message);
    }
  } else {
    memoryDb.emails = memoryDb.emails.map(e =>
      e.id === email.id
        ? { ...e, deliveryStatus: status, deliveryError: smtpRes.error || undefined }
        : e
    );
    saveDbToDisk(memoryDb);
  }

  return res.json({
    ok: smtpRes.sent,
    deliveryStatus: status,
    error: smtpRes.error,
  });
});

// 4. GET & POST SMTP Configuration (for Admin Dashboard)
app.get('/api/smtp-config', (_req, res) => {
  res.json({
    smtpHost: smtpConfig.smtpHost,
    smtpPort: smtpConfig.smtpPort,
    smtpSecure: smtpConfig.smtpSecure,
    smtpUser: smtpConfig.smtpUser,
    smtpPass: smtpConfig.smtpPass ? '••••••••••••••••' : '',
    hasPassword: Boolean(smtpConfig.smtpPass),
    senderName: smtpConfig.senderName,
    enabled: smtpConfig.enabled,
  });
});

app.post('/api/smtp-config', async (req, res) => {
  const body = req.body || {};
  const nextPass =
    body.smtpPass && !String(body.smtpPass).includes('••')
      ? String(body.smtpPass).trim()
      : smtpConfig.smtpPass;

  saveSmtpToDisk({
    smtpHost: body.smtpHost || smtpConfig.smtpHost,
    smtpPort: Number(body.smtpPort) || smtpConfig.smtpPort,
    smtpSecure: typeof body.smtpSecure === 'boolean' ? body.smtpSecure : smtpConfig.smtpSecure,
    smtpUser: body.smtpUser ?? smtpConfig.smtpUser,
    smtpPass: nextPass,
    senderName: body.senderName || smtpConfig.senderName,
    enabled: body.enabled !== false,
  });

  if (useMysql && pool) {
    try {
      await pool.query(
        `INSERT INTO smtp_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, sender_name, enabled)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           smtp_host = VALUES(smtp_host),
           smtp_port = VALUES(smtp_port),
           smtp_secure = VALUES(smtp_secure),
           smtp_user = VALUES(smtp_user),
           smtp_pass = VALUES(smtp_pass),
           sender_name = VALUES(sender_name),
           enabled = VALUES(enabled)`,
        [
          smtpConfig.smtpHost,
          smtpConfig.smtpPort,
          smtpConfig.smtpSecure ? 1 : 0,
          smtpConfig.smtpUser,
          smtpConfig.smtpPass,
          smtpConfig.senderName,
          smtpConfig.enabled ? 1 : 0,
        ]
      );
    } catch (err) {
      console.warn('Failed to save SMTP config to MySQL:', err.message);
    }
  }

  res.json({
    ok: true,
    hasPassword: Boolean(smtpConfig.smtpPass),
    message: 'Konfigurasi SMTP berhasil disimpan.',
  });
});

// 5. POST Test Email Delivery
app.post('/api/smtp-test', async (req, res) => {
  const { testRecipient } = req.body || {};
  const recipient = (testRecipient || smtpConfig.smtpUser || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return res.status(400).json({
      ok: false,
      error: 'Masukkan alamat email tujuan tes yang valid.',
    });
  }

  const smtpRes = await sendRealEmailViaSmtp({
    id: `test-${Date.now()}`,
    recipientEmail: recipient,
    recipientName: 'Admin ODipinjam',
    itemName: 'Tes Koneksi Email Server ODipinjam',
    itemQrCode: 'INV-TEST-0001',
    type: 'konfirmasi_peminjaman',
    subject: '[Tes Email Berhasil] Sistem Notifikasi Email ODipinjam Aktif',
    body: `Halo,\n\nSelamat! Pengaturan SMTP Email Pengirim pada sistem ODipinjam telah berhasil terhubung.\n\nSeluruh notifikasi peminjaman, pengembalian, peringatan batas waktu hampir habis, serta keterlambatan pengembalian kini akan dikirimkan secara otomatis langsung ke kotak masuk email/Gmail masing-masing anggota.`,
  });

  if (!smtpRes.sent) {
    return res.status(400).json({
      ok: false,
      error: smtpRes.error || 'Gagal mengirim email tes.',
    });
  }

  return res.json({
    ok: true,
    message: `Email tes berhasil dikirim langsung ke kotak masuk ${recipient}! Silakan cek Inbox / Spam.`,
  });
});

// 6. Google Drive Image Proxy (Bypasses browser 3rd-party cookie / ORB blocks)
app.get('/api/drive-image/:fileId', async (req, res) => {
  const fileId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!fileId) {
    return res.status(400).send('Invalid Google Drive fileId');
  }

  const candidateUrls = [
    `https://lh3.googleusercontent.com/d/${fileId}=w1000`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ];

  for (const targetUrl of candidateUrls) {
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      if (!upstream.ok) continue;
      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        continue;
      }
      const arrayBuf = await upstream.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length < 100) continue;

      res.setHeader(
        'Content-Type',
        contentType.startsWith('image/') ? contentType : 'image/jpeg'
      );
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    } catch {
      // try next candidate URL
    }
  }

  return res.status(404).send('Google Drive image not accessible');
});

app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ODipinjam server listening on port ${PORT}`);
});
