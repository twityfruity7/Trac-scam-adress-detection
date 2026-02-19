# 🔍 TRAC Risk Detector

> **P2P Scam & Risk Detection Agent built on Intercom / Trac Network**

A security-focused agent that helps users detect scam wallet addresses and phishing messages in real-time using rule-based risk analysis over the Intercom P2P network.
<img width="1279" height="853" alt="image" src="https://github.com/user-attachments/assets/a8a4df3e-0c6d-4666-9408-6e40154f43c6" />
<img width="1335" height="874" alt="image" src="https://github.com/user-attachments/assets/51d6984f-4406-40cd-aa56-2759713179cc" />

---

## 🎯 TRAC Address for Payout

```
trac1vahuct3qlywvv6the9ugnn43vnjz8fr24wyw8vvvc7k9kthzja7s2nyc00
```

>  Replace `trac1vahuct3qlywvv6the9ugnn43vnjz8fr24wyw8vvvc7k9kthzja7s2nyc00` with your actual Trac wallet address before submitting.

---

## 📸 App Preview

The app features a dark terminal-aesthetic UI with:
- Real-time wallet address risk scoring (0–100)
- Message/phishing text analysis
- Flag-based detection (dust attacks, high TX frequency, scam keywords)
- Live network stats dashboard
- Quick-action sidebar for common checks

---

## 🚀 Features

| Feature | Description |
|---|---|
| 🔎 Address Analysis | Check ETH/BTC/TRAC wallet addresses for risk signals |
| 📩 Message Scan | Detect scam keywords, urgency tactics, and phishing URLs |
| 📊 Risk Score | 0–100 score with visual indicator (Safe → Low → Medium → High) |
| ⚠️ Flag Detection | Entropy check, zero count, TX frequency, wallet age heuristics |
| 🌐 P2P Ready | Built to run as an Intercom agent node |

---

## 🛠 Tech Stack

- **Backend:** Python 3 + Flask + Flask-CORS
- **Frontend:** Pure HTML/CSS/JS (no frameworks, single file)
- **Network:** Intercom P2P (Trac Network)
- **Logic:** Rule-based risk engine (no external API needed)

---

## ⚡ Quick Start

```bash
# 1. Clone
https://github.com/twityfruity7/Trac-scam-adress-detection.git
cd Trac-scam-adress-detection

# 2. Install dependencies
pip install flask flask-cors

# 3. Run
python app.py

# 4. Open browser
open http://localhost:5000
```

---

## 💬 How to Use

Type or paste into the chat:

```
# Check a wallet address
Check this address: 0x742d35Cc6634C0532925a3b8D4C9D4B5C7

# Analyze a suspicious message
Is this message safe? "You won a free airdrop! Claim now: http://..."

# Get help
help
```

---

## 🔬 Risk Detection Methods

1. **Entropy Analysis** — Low unique character count signals crafted addresses
2. **Zero Count Check** — Excess zeros = likely generated/vanity address
3. **TX Frequency** — Abnormally high transactions in short time = bot/spam
4. **Wallet Age Heuristic** — New wallet + high activity = red flag
5. **Dust Attack Detection** — Zero balance + high TX count
6. **Known Scam Database** — Burn addresses and known blacklist
7. **Keyword Scoring** — "free", "airdrop", "100x", "guaranteed", etc.
8. **Urgency Language** — "Act now", "Last chance", "Expire" detection
9. **URL Extraction** — Auto-detects and flags embedded links

---

## 🏗 Project Structure

```
.
├── app.py          # Flask backend + risk engine (Python)
├── index.html      # Frontend chat UI (single file, no build step)
├── SKILL.md        # Agent skill instructions for Intercom
└── README.md       # This file
```

---

## 🤝 Intercom Integration

This app runs as an Intercom agent. The skill file (`SKILL.md`) defines how other agents should interact with this risk detector over P2P sidechannels.

**Upstream:** https://github.com/Trac-Systems/intercom

---

## 📄 License

MIT — Fork freely, build on top, win together.
