#!/usr/bin/env python3
"""
TRAC Risk Detector - P2P Scam & Risk Detection Agent
Built on Intercom / Trac Network
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import hashlib
import time
import re
import random
import os

app = Flask(__name__, static_folder='.')
CORS(app)

# ─────────────────────────────────────────────────────────────────────────────
# Rule-based Risk Engine
# ─────────────────────────────────────────────────────────────────────────────

KNOWN_SCAM_PATTERNS = [
    "0x000000000000000000000000000000000000dead",
    "0x0000000000000000000000000000000000000000",
]

SUSPICIOUS_KEYWORDS = [
    "free", "airdrop", "100x", "guaranteed", "send eth", "double your",
    "connect wallet", "claim now", "limited time", "whitelist",
]

def analyze_address(address: str) -> dict:
    """Analyze a wallet address for risk signals."""
    address = address.strip().lower()
    risk_score = 0
    flags = []
    details = []

    # Format validation
    eth_pattern = re.compile(r'^0x[0-9a-f]{40}$')
    btc_pattern = re.compile(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$')
    trac_pattern = re.compile(r'^[a-zA-Z0-9]{20,60}$')

    is_eth = eth_pattern.match(address)
    is_btc = btc_pattern.match(address)

    if not is_eth and not is_btc and len(address) < 20:
        return {
            "valid": False,
            "risk_score": 0,
            "risk_level": "UNKNOWN",
            "flags": ["Invalid address format"],
            "details": "Address format not recognized. Supported: ETH (0x...), BTC, TRAC."
        }

    addr_type = "ETH" if is_eth else ("BTC" if is_btc else "TRAC/OTHER")

    # Check known scam addresses
    if address in KNOWN_SCAM_PATTERNS:
        risk_score += 90
        flags.append("⛔ Known scam/burn address")

    # Entropy check — repeated characters
    unique_chars = len(set(address.replace("0x", "")))
    if unique_chars < 5:
        risk_score += 30
        flags.append("⚠️ Low entropy — suspicious character repetition")
        details.append("Addresses with very few unique characters may be crafted to deceive.")

    # Vanity address check (too many zeros)
    zero_count = address.count('0')
    if zero_count > 10:
        risk_score += 20
        flags.append("⚠️ High zero count — possible vanity/generated address")

    # Simulate blockchain activity (rule-based mock)
    seed = int(hashlib.md5(address.encode()).hexdigest(), 16)
    tx_count = seed % 5000
    age_days = seed % 365
    balance = (seed % 100000) / 1000

    if tx_count > 2000 and age_days < 30:
        risk_score += 35
        flags.append("🚨 Abnormally high transaction frequency")
        details.append(f"~{tx_count} txs in {age_days} days suggests bot or spam activity.")

    if age_days < 7 and tx_count > 100:
        risk_score += 25
        flags.append("⚠️ Very new wallet with high activity")
        details.append("Newly created wallets with sudden high activity are common in scams.")

    if balance == 0 and tx_count > 500:
        risk_score += 15
        flags.append("⚠️ Zero balance despite high transaction count — possible dust attacker")

    risk_score = min(risk_score, 100)

    if risk_score >= 70:
        level = "HIGH"
        verdict = "🔴 HIGH RISK — Avoid interaction with this address."
    elif risk_score >= 40:
        level = "MEDIUM"
        verdict = "🟡 MEDIUM RISK — Proceed with caution."
    elif risk_score >= 15:
        level = "LOW"
        verdict = "🟢 LOW RISK — Appears relatively safe, but always DYOR."
    else:
        level = "SAFE"
        verdict = "✅ SAFE — No significant risk signals detected."

    return {
        "valid": True,
        "address": address,
        "type": addr_type,
        "risk_score": risk_score,
        "risk_level": level,
        "verdict": verdict,
        "flags": flags if flags else ["No suspicious patterns detected."],
        "simulated_stats": {
            "estimated_tx_count": tx_count,
            "wallet_age_days": age_days,
            "estimated_balance": f"{balance:.3f}",
        },
        "details": details,
    }


def analyze_message(text: str) -> dict:
    """Analyze a text message for scam indicators."""
    text_lower = text.lower()
    risk_score = 0
    flags = []

    for kw in SUSPICIOUS_KEYWORDS:
        if kw in text_lower:
            risk_score += 15
            flags.append(f"⚠️ Suspicious keyword detected: '{kw}'")

    # URL check
    urls = re.findall(r'https?://\S+', text)
    if urls:
        risk_score += 20
        flags.append(f"🔗 Contains {len(urls)} URL(s) — verify before clicking")

    # Urgency patterns
    urgency = re.search(r'\b(urgent|hurry|expire|last chance|act now)\b', text_lower)
    if urgency:
        risk_score += 25
        flags.append("🚨 Urgency language detected — classic social engineering tactic")

    risk_score = min(risk_score, 100)

    if risk_score >= 60:
        verdict = "🔴 HIGH RISK message — likely a scam attempt."
    elif risk_score >= 30:
        verdict = "🟡 SUSPICIOUS — contains multiple red flags."
    else:
        verdict = "🟢 LOW RISK — no obvious scam indicators."

    return {
        "type": "message_analysis",
        "risk_score": risk_score,
        "verdict": verdict,
        "flags": flags if flags else ["No obvious scam patterns detected."],
    }


def parse_intent(user_input: str) -> dict:
    """Parse user input and route to appropriate analysis."""
    text = user_input.strip()

    # Check for address
    eth_match = re.search(r'0x[0-9a-fA-F]{40}', text)
    btc_match = re.search(r'\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b|\bbc1[a-z0-9]{39,59}\b', text)

    if eth_match or btc_match:
        address = (eth_match or btc_match).group(0)
        result = analyze_address(address)
        return {
            "intent": "address_check",
            "result": result,
        }

    # Check for message/text analysis
    if any(w in text.lower() for w in ["is this", "check this message", "is it safe", "scam?"]):
        result = analyze_message(text)
        return {
            "intent": "message_check",
            "result": result,
        }

    # Help / greeting
    if any(w in text.lower() for w in ["hello", "hi", "help", "what can"]):
        return {
            "intent": "help",
            "result": {
                "message": (
                    "👋 Welcome to **TRAC Risk Detector**!\n\n"
                    "I can help you:\n"
                    "• **Check a wallet address** — paste any ETH/BTC/TRAC address\n"
                    "• **Analyze a suspicious message** — paste it and ask 'is this safe?'\n"
                    "• **Detect scam patterns** — I'll flag keywords, urgency tactics, and more\n\n"
                    "Try: `Check this address: 0x742d35Cc6634C0532925a3b8D4C9D4...`"
                )
            }
        }

    # Default: treat as message analysis
    result = analyze_message(text)
    return {
        "intent": "message_check",
        "result": result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({"error": "No message provided"}), 400

    user_input = data['message']
    response = parse_intent(user_input)
    return jsonify(response)

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "agent": "TRAC-Risk-Detector", "version": "1.0.0"})

@app.route('/api/stats', methods=['GET'])
def stats():
    """Return mock network stats for dashboard."""
    return jsonify({
        "total_analyzed": random.randint(1200, 1800),
        "scams_flagged": random.randint(340, 500),
        "safe_addresses": random.randint(700, 1100),
        "network": "Trac / Intercom P2P",
        "uptime": "99.9%",
    })


if __name__ == '__main__':
    print("🔍 TRAC Risk Detector Agent running...")
    print("📡 Connected to Intercom P2P network simulation")
    print("🌐 Open http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
