
# LAN Print Server

A tiny local web app to let devices on your network upload a file and print it using the printer connected to this PC.

> **Supported OS**: Linux/macOS (via CUPS) and Windows (SumatraPDF preferred, PowerShell fallback).

## Quick start

```bash
# 1) Extract and enter the folder
cd lan-print-server

# 2) Install
npm install

# 3) (Optional) Set a shared access token
# On Linux/macOS:
export ACCESS_TOKEN="mysecret"
# On Windows PowerShell:
# $env:ACCESS_TOKEN="mysecret"

# 4) (Windows optional) If using SumatraPDF, set path if not auto-detected:
# $env:SUMATRA_PATH="C:\Program Files\SumatraPDF\SumatraPDF.exe"

# 5) Run
npm start
```

On the server PC, you should see:
```
LAN Print Server running on http://0.0.0.0:3000
Open from other devices via http://<your-lan-ip>:3000
```

From another device on your LAN (phone, tablet, laptop), open a browser to:
```
http://<your-lan-ip>:3000
```

> **Find your LAN IP**  
> - **Windows:** `ipconfig` (look for IPv4 Address)  
> - **macOS/Linux:** `ifconfig` or `ip addr`

> **Firewall**: Allow inbound TCP on port 3000 on the server PC.

## Printing details

- **Linux/macOS**: Uses `lp` (CUPS). If `lp` fails, tries `lpr`.
- **Windows**: Uses **SumatraPDF** if available, which supports silent printing to a specific printer.  
  If not available, falls back to PowerShell `Start-Process -Verb PrintTo/Print` (uses the default app for the file type).

**Tip for Windows:** Install [SumatraPDF](https://www.sumatrapdfreader.org/free-pdf-reader.html) and set `SUMATRA_PATH` if needed. This makes printing PDFs/images reliable and fast.

## Security

- By default, anyone on your LAN can print via the page.  
- Set `ACCESS_TOKEN` to require a shared token to submit jobs. The page has a field for it.

## Supported file types
- PDFs and common images (`.pdf, .png, .jpg, .jpeg, .bmp, .tif, .tiff`) and `.txt`.
- Other types may work on Windows if the associated app supports Print/PrintTo verbs.

## Troubleshooting

- **No printers listed**: You can still submit to the **default printer**. On Linux/macOS ensure CUPS is installed and your printer is configured. On Windows ensure your printer is installed.
- **Windows prints to the wrong printer**: Provide the exact printer name in the dropdown or install SumatraPDF and use the `-print-to` path.
- **Permission denied / firewall**: Allow Node on your firewall, and open inbound TCP 3000.
- **Large files**: The server limits uploads to 50MB by default (adjust in `server.js`).

## Notes

- Uploaded files are stored temporarily in `uploads/` and removed ~60 seconds after submission.
- Consider keeping this app on a trusted network only.
