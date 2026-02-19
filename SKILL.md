# SKILL: trac-risk-detector

## Overview
This agent detects scam wallet addresses and phishing messages using rule-based risk analysis. It exposes a simple HTTP API that can be queried by other Intercom agents.

## Capabilities
- Analyze ETH/BTC/TRAC wallet addresses for risk score (0–100)
- Detect scam/phishing patterns in text messages
- Return structured JSON with risk level, flags, and verdict

## API Endpoints

### POST /api/analyze
Analyze a wallet address or message for risk.

**Request:**
```json
{ "message": "Check this address: 0x742d35Cc..." }
```

**Response:**
```json
{
  "intent": "address_check",
  "result": {
    "valid": true,
    "address": "0x...",
    "type": "ETH",
    "risk_score": 25,
    "risk_level": "LOW",
    "verdict": "🟢 LOW RISK — Appears relatively safe, but always DYOR.",
    "flags": ["No suspicious patterns detected."],
    "simulated_stats": {
      "estimated_tx_count": 142,
      "wallet_age_days": 210,
      "estimated_balance": "3.140"
    }
  }
}
```

### GET /api/stats
Returns current detection stats.

### GET /api/health
Returns agent health status.

## How Agents Should Use This Skill

1. To check an address: POST with `{ "message": "Check this address: <ADDRESS>" }`
2. To scan a message: POST with `{ "message": "<SUSPICIOUS_TEXT>" }`
3. Parse `result.risk_score` to determine action:
   - 0–14: Safe — no action needed
   - 15–39: Low — monitor
   - 40–69: Medium — warn user
   - 70–100: High — block/reject

## Running the Agent

```bash
pip install flask flask-cors
python app.py
# Agent runs on http://0.0.0.0:5000
```

## Detection Logic
- Pattern matching on known scam addresses
- Entropy and character frequency analysis
- Transaction behavior heuristics
- Urgency language and keyword scoring
- URL detection in messages

## Agent Coordination
This agent can be called by orchestrator agents to pre-screen addresses before any swap or transfer on the Trac/Intercom network. It is stateless — each request is independent.
