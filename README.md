# DW5821e ATCOM

Web-based AT command terminal for **Dell DW5821e** (Qualcomm Snapdragon X20 LTE) modems.

## Features

- AT terminal with quick chips + history
- Preset commands with **detailed execution log**
- Port selector (`/dev/ttyUSB0`, `/dev/ttyUSB1`)
- Login password protection (session file, survives restart)
- **SMS Inbox** (read / send / delete)
  - ModemManager (`mmcli`) primary
  - AT secondary
  - Local history so more than live MM list can be shown
  - Refresh auto-runs OpenWrt-style CNMI/CPMS setup
  - Auto-detects ModemManager index (`Modem/1` → `Modem/2` → …)
- IMEI backup / NV550 prepare & step-by-step apply
- Qualcomm NV550 encoding compatible with OpenWrt DW5821e manager

> ⚠️ Changing IMEI may be restricted by local law. Use only on devices you own and only where permitted.

## Requirements

- Linux with serial device nodes (`/dev/ttyUSB*`)
- Node.js 18+
- `gcc` (to build `at_exec`)
- ModemManager + `mmcli` (for SMS inbox)
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
# or with pm2:
# pm2 start server.js --name at-terminal
```

Open: `http://localhost:3100`

Default config (from `.env.example`):
- Port: `3100`
- AT port: `/dev/ttyUSB1`
- Password: set in `.env`

## UI tabs

| Tab | Function |
|-----|----------|
| **Terminal** | Free AT input + quick chips (`quick()` → terminal log) |
| **Presets** | Grouped AT shortcuts (`runPreset()` → detailed preset log) |
| **Inbox** | SMS list / send / delete, Refresh = setup + load |
| **IMEI** | Backup / prepare NV550 / apply per-step with confirm |

## Project structure

```text
server.js                 # Express API + auth + routes
sms.js                    # Thin entry → ./sms/*
sms/
  mmcli.js                # ModemManager SMS list/read/send/delete
  at.js                   # AT CMGF/CPMS/CNMI/CMGL
  history.js              # Local SMS history (data/sms/history.json)
  index.js                # Facade used by server routes
tools/at_exec.c           # Serial AT helper
public/
  index.html              # Dashboard UI
  login.html              # Login page
  css/
  js/
    api.js                # Fetch helpers
    terminal.js           # Terminal tab
    presets.js            # Preset detailed log
    inbox.js              # Inbox tab
    imei.js               # IMEI tab
    app.js                # App bootstrap / tabs
```

## API (auth required)

### Auth / modem
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Login |
| POST | `/api/logout` | Logout |
| GET | `/api/status` | Port status |
| POST | `/api/port` | Switch AT port |
| POST | `/api/at` | Send AT command |
| POST | `/api/at/batch` | Send multiple AT commands |

### SMS Inbox
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sms/inbox` | List SMS (mmcli + AT + local history) |
| GET | `/api/sms` | Same list as array |
| GET | `/api/sms/storage` | AT `CPMS?` storage info |
| POST | `/api/sms/setup` | OpenWrt-style CMGF/CPMS/CNMI setup |
| POST | `/api/sms/send` | Send SMS via mmcli |
| DELETE | `/api/sms/:id` | Delete one SMS |
| DELETE | `/api/sms` | Delete all SMS + clear history |
| GET | `/api/sms/history` | Local history only |
| DELETE | `/api/sms/history` | Clear local history |

### IMEI
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/imei` | Read IMEI via `ATI` |
| POST | `/api/imei/backup` | Backup IMEI to `data/imei/` |
| POST | `/api/imei/preview` | Preview NV550 hex |
| POST | `/api/imei/restore` | Prepare IMEI steps (no auto-apply) |
| POST | `/api/imei/step` | Apply one IMEI step (`confirm=true` for dangerous steps) |

## SMS notes (DW5821e)

OpenWrt manager style:

```text
AT+CMGF=1
AT+CPMS="ME","ME","ME"
AT+CNMI=2,1,0,0,0
```

- Received SMS is primarily read via **ModemManager** (`mmcli`)
- AT storage may stay empty even when MM has messages
- ModemManager index is **auto-detected** each call (`mmcli -L`)
- Local history keeps previously seen SMS after MM list shrinks

Inbox **Refresh** automatically runs setup then loads messages.

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
- ModemManager may cache IMEI until modem/service restart
- AT port may need manual switch if `ttyUSB*` mapping changes
- Prefer not running many concurrent AT commands (serial port is exclusive)

## License

Use at your own risk.
