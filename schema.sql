-- Skema Database MySQL untuk ODipinjam (Hostinger)
-- Database: `u232199593_odipinjam`

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

CREATE TABLE IF NOT EXISTS inventory_items (
  id VARCHAR(64) PRIMARY KEY,
  qr_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) DEFAULT 'Umum',
  total_stock INT UNSIGNED DEFAULT 1,
  available_stock INT UNSIGNED DEFAULT 1,
  location VARCHAR(150) DEFAULT 'Gudang Utama',
  `condition` ENUM('Baik', 'Perlu Perawatan') DEFAULT 'Baik',
  description TEXT,
  image_url LONGTEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Akun Administrator Utama default jika tabel users masih kosong
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
