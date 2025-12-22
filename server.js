const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const USERS_FILE = path.join(__dirname, 'users.json');
const PROGRESS_FILE = path.join(__dirname, 'progress.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-token';
const PORT = process.env.PORT || 3000;

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read users.json', e);
    return {};
  }
}

function saveUsers(obj) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function loadProgress() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return {};
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read progress.json', e);
    return {};
  }
}

function saveProgress(obj) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// API: login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing' });
  const users = loadUsers();
  const hash = users[username];
  if (!hash) return res.status(404).json({ error: 'not_found' });
  if (!bcrypt.compareSync(password, hash)) return res.status(401).json({ error: 'wrong_password' });
  return res.json({ ok: true });
});

// API: register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing' });
  const users = loadUsers();
  if (users && Object.keys(users).length > 0 && users[username]) {
    return res.status(409).json({ error: 'exists' });
  }
  // if users.json already has entries, prevent registration unless admin
  if (users && Object.keys(users).length > 0) {
    return res.status(403).json({ error: 'registration_disabled' });
  }
  const hash = bcrypt.hashSync(password, 10);
  users[username] = hash;
  saveUsers(users);
  return res.status(201).json({ ok: true });
});

// API: submit progress (public) - save elapsed time and simple metadata
app.post('/api/progress', (req, res) => {
  const body = req.body || {};
  const { username, id, elapsed, n, numbersCount } = body;
  if (!username || typeof id === 'undefined' || typeof elapsed === 'undefined') return res.status(400).json({ error: 'missing' });
  const progress = loadProgress();
  progress[username] = progress[username] || { times: {} };
  progress[username].times = progress[username].times || {};
  progress[username].times[id] = { ms: Number(elapsed), n: n || null, numbersCount: numbersCount || null };
  saveProgress(progress);
  res.json({ ok: true });
});

// API: get progress (public)
app.get('/api/progress', (req, res) => {
  const progress = loadProgress();
  res.json(progress);
});

// Admin: list users (hashes) - protected by ADMIN_TOKEN header
app.get('/api/users', (req, res) => {
  const token = req.header('x-admin-token');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const users = loadUsers();
  res.json(users);
});

// Admin: delete user
app.delete('/api/users/:username', (req, res) => {
  const token = req.header('x-admin-token');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const users = loadUsers();
  const u = req.params.username;
  if (!users[u]) return res.status(404).json({ error: 'not_found' });
  delete users[u];
  saveUsers(users);
  res.json({ ok: true });
});

// Serve static files (the app)
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin token: set ADMIN_TOKEN env var to change. Current token (env not set) is 'admin-token'`);
});
