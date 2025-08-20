
/* LAN Print Server - cross-platform (Linux/macOS/Windows) 
 * - Serves a simple web page for uploading files to print
 * - On Linux/macOS: uses CUPS (lp / lpr)
 * - On Windows: prefers SumatraPDF (if found) or falls back to PowerShell Print/PrintTo
 * 
 * SECURITY: This is intended for your trusted local network.
 * Optionally set ACCESS_TOKEN to require a shared token for all requests.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { exec, execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || null;
const SUMATRA_PATH = process.env.SUMATRA_PATH || null; // Windows: path to SumatraPDF.exe (optional)

// storage for uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-()+ ]+/g, '_');
    cb(null, `${ts}__${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// optional token protection
app.use((req, res, next) => {
  if (!ACCESS_TOKEN) return next();
  const headerToken = req.headers['x-access-token'];
  const token = headerToken || req.body.token || req.query.token;
  if (token === ACCESS_TOKEN) return next();
  res.status(401).json({ ok: false, error: 'Unauthorized: missing or invalid token' });
});

// Utilities
function isWin() { return process.platform === 'win32'; }
function isLinux() { return process.platform === 'linux'; }
function isMac() { return process.platform === 'darwin'; }

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...opts, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function whichSumatraCandidates() {
  const candidates = [];
  if (process.env.SUMATRA_PATH) candidates.push(process.env.SUMATRA_PATH);
  candidates.push('SumatraPDF.exe');
  candidates.push('C:\\\\Program Files\\\\SumatraPDF\\\\SumatraPDF.exe');
  candidates.push('C:\\\\Program Files (x86)\\\\SumatraPDF\\\\SumatraPDF.exe');
  return candidates;
}

async function findSumatra() {
  if (!isWin()) return null;
  const candidates = whichSumatraCandidates();
  for (const cand of candidates) {
    try {
      // If it's an absolute path, check existence
      if (cand.includes(':') || cand.startsWith('\\') || cand.startsWith('/')) {
        if (fs.existsSync(cand)) return cand;
      } else {
        // try to resolve from PATH
        const out = await run(`where ${cand}`);
        if (out) return out.split(/\r?\n/)[0];
      }
    } catch {}
  }
  return null;
}

async function listPrinters() {
  if (isLinux() || isMac()) {
    // Use lpstat to list printers
    try {
      const out = await run('lpstat -a');
      // lines like: "HP_LaserJet accepting requests since ..."
      const printers = out.split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => ({
          name: line.split(' ')[0],
          default: false,
        }));
      // try to detect default
      try {
        const defOut = await run('lpstat -d'); // "system default destination: <name>"
        const m = defOut.match(/default destination:\s+(.+)$/i);
        const defName = m ? m[1].trim() : null;
        if (defName) {
          for (const p of printers) if (p.name === defName) p.default = true;
        }
      } catch {}
      return printers;
    } catch (e) {
      return [];
    }
  } else if (isWin()) {
    // Use PowerShell to list printers
    try {
      const ps = `powershell -NoProfile -Command "Get-Printer | Select-Object Name,Shared,Default | ConvertTo-Json"`;
      const out = await run(ps);
      const arr = JSON.parse(out);
      const printers = Array.isArray(arr) ? arr : [arr];
      return printers.map(p => ({ name: p.Name, default: !!p.Default }));
    } catch (e) {
      // fallback to WMIC (deprecated but often available)
      try {
        const out = await run('wmic printer get Name,Default /format:csv');
        const lines = out.split(/\r?\n/).slice(1).filter(Boolean);
        const printers = lines.map(l => {
          const parts = l.split(',');
          const name = parts.pop();
          const def = (parts.pop() || '').trim().toLowerCase() === 'true';
          return { name, default: def };
        });
        return printers;
      } catch {
        return [];
      }
    }
  }
  return [];
}

async function printFile({ filePath, printer, copies = 1 }) {
  copies = Math.max(1, parseInt(copies) || 1);

  if (isLinux() || isMac()) {
    const p = printer ? `-d "${printer.replace(/"/g, '\\"')}"` : '';
    const c = copies > 1 ? `-n ${copies}` : '';
    // Use lp (preferred). If lp is missing, try lpr.
    try {
      const cmd = `lp ${p} ${c} "${filePath}"`.trim().replace(/\s+/g, ' ');
      const out = await run(cmd);
      return { ok: true, method: 'lp', message: out };
    } catch (e) {
      const P = printer ? `-P "${printer.replace(/"/g, '\\"')}"` : '';
      const cmd = `lpr ${P} "${filePath}"`;
      // For multiple copies with lpr, it may require -# flag; try it if copies > 1
      try {
        const copiesFlag = copies > 1 ? ` -# ${copies}` : '';
        const out = await run(`lpr${copiesFlag} ${P} "${filePath}"`);
        return { ok: true, method: 'lpr', message: out };
      } catch (err2) {
        return { ok: false, error: err2.message };
      }
    }
  } else if (isWin()) {
    // Prefer SumatraPDF for PDFs/images
    const sumatra = await findSumatra();
    const ext = path.extname(filePath).toLowerCase();

    if (sumatra && ['.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.txt'].includes(ext)) {
      // SumatraPDF supports silent printing to specific printer
      const args = [];
      if (printer) {
        args.push('-print-to', printer);
      } else {
        args.push('-print-to-default');
      }
      // repeat for copies
      for (let i = 0; i < copies; i++) {
        args.push(filePath);
      }
      const cmd = `"${sumatra}" ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
      try {
        const out = await run(cmd);
        return { ok: true, method: 'SumatraPDF', message: out };
      } catch (e) {
        // fall through to PS
      }
    }

    // PowerShell PrintTo / Print (depends on the default app for the file type)
    try {
      // Use a small PS script to loop copies
      const ps = [
        'powershell -NoProfile -Command',
        '"',
        '$ErrorActionPreference = \'Stop\';',
        `$file = '${filePath.replace(/'/g, "''")}';`,
        `$copies = ${copies};`,
        printer ? `$printer = '${printer.replace(/'/g, "''")}';` : '$printer = $null;',
        'for ($i = 0; $i -lt $copies; $i++) {',
        '  if ($printer) {',
        '    Start-Process -FilePath $file -Verb PrintTo -ArgumentList $printer | Out-Null;',
        '  } else {',
        '    Start-Process -FilePath $file -Verb Print | Out-Null;',
        '  }',
        '  Start-Sleep -Milliseconds 500;',
        '}',
        '"'
      ].join(' ');
      const out = await run(ps);
      return { ok: true, method: 'PowerShell PrintTo', message: out };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  } else {
    return { ok: false, error: 'Unsupported platform' };
  }
}

// Routes
app.get('/api/printers', async (req, res) => {
  try {
    const printers = await listPrinters();
    res.json({ ok: true, printers });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/print', upload.single('file'), async (req, res) => {
  try {
    const filePath = req.file?.path;
    const { printer, copies } = req.body;
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const result = await printFile({ filePath, printer, copies });
    // schedule deletion of the temp file
    setTimeout(() => {
      fs.unlink(filePath, () => {});
    }, 60_000);

    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN Print Server running on http://0.0.0.0:${PORT}`);
  console.log(`Open from other devices via http://<your-lan-ip>:${PORT}`);
  if (ACCESS_TOKEN) {
    console.log('ACCESS_TOKEN is enabled. Clients must include the token.');
  } else {
    console.log('No ACCESS_TOKEN set. Anyone on your LAN can submit prints.');
  }
});
