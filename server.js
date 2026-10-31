import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, 'data');
const dbFilePath = path.join(dataDir, 'odipinjam-db.json');

app.use(express.json({ limit: '50mb' }));

let memoryDb = {
  initialized: false,
  users: [],
  items: [],
  loans: [],
  emails: [],
  updatedAt: null,
};

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

loadDbFromDisk();

app.get('/api/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(memoryDb);
});

app.post('/api/state', (req, res) => {
  const { users, items, loans, emails } = req.body || {};
  saveDbToDisk({ users, items, loans, emails });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, state: memoryDb });
});

app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ODipinjam server listening on port ${PORT}`);
});
