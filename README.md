# DW5821e ATCOM

Web-based AT command terminal for **Dell DW5821e** (Qualcomm Snapdragon X20 LTE) modems.

Includes:
- AT terminal with presets
- Port selector (`/dev/ttyUSB0`, `/dev/ttyUSB1`)
- Login password protection
- IMEI backup / NV550 prepare & step-by-step apply
- Qualcomm NV550 encoding compatible with OpenWrt DW5821e manager

> ⚠️ Changing IMEI may be restricted by local law. Use only on devices you own and only where permitted.

## Requirements

- Linux with serial device nodes (`/dev/ttyUSB*`)
- Node.js 18+
- `gcc` (to build `at_exec`)
- User permission to access the modem serial port (usually `dialout` group)

## Setup

```bash
git clone https://github.com/masjeho2/dw5821e-atcom.git
cd dw5821e-atcom

# install deps
npm install

# build AT serial helper
gcc -O2 -o /usr/local/bin/at_exec tools/at_exec.c

# configure
cp .env.example .env
# edit AUTH_PASSWORD / AT_PORT / PORT

# run
npm start
```

Open: `http://localhost:3100`

Default config (from `.env.example`):
- Port: `3100`
- AT port: `/dev/ttyUSB1`
- Password: set in `.env`

## Project structure

```text
server.js              # Express API + auth + IMEI/NV550 logic
tools/at_exec.c        # Serial AT command helper
public/
  index.html           # Dashboard UI
  login.html           # Login page
  css/                 # Styles
  js/
    api.js             # Fetch helpers
    terminal.js        # Terminal tab
    imei.js            # IMEI tab
    app.js             # App bootstrap
```

## API (auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Login |
| POST | `/api/logout` | Logout |
| GET | `/api/status` | Port status |
| POST | `/api/port` | Switch AT port |
| POST | `/api/at` | Send AT command |
| GET | `/api/imei` | Read IMEI via `ATI` |
| POST | `/api/imei/backup` | Backup IMEI to `data/imei/` |
| POST | `/api/imei/preview` | Preview NV550 hex |
| POST | `/api/imei/restore` | Prepare IMEI steps (no auto-apply) |
| POST | `/api/imei/step` | Apply one IMEI step (`confirm=true` for dangerous steps) |

## IMEI NV550 format

Same algorithm as OpenWrt DW5821e manager:

1. Prepend `80A` to IMEI
2. Split into byte pairs
3. Swap nibbles
4. Join with commas

Example:
```text
IMEI: 354068084899466
NV550: 08,3A,45,60,08,48,98,49,66
AT^NV=550,9,"08,3A,45,60,08,48,98,49,66"
```

Recommended flow:
1. Backup current IMEI
2. Prepare new IMEI
3. Step 1 read `AT^NV=550`
4. Step 2 clear `AT^NV=550,"0"`
5. Step 3 write `AT^NV=550,9,"..."`
6. Step 4 restart `AT+CFUN=1,1`
7. Step 5 verify `ATI`

Dangerous steps require explicit confirmation.

## Notes

- `.env`, `data/`, and session files are gitignored
- ModemManager may keep a cached IMEI until modem/service restart
- Some AT ports may be busy; switch between `ttyUSB0` / `ttyUSB1` if needed

## License

Use at your own risk.
