import Feature from 'trac-peer/src/artifacts/feature.js';

import { PriceOracle } from '../../src/price/oracle.js';

const nowMs = () => Date.now();

class PriceOracleFeature extends Feature {
  constructor(peer, config = {}) {
    super(peer, config);
    this.key = 'price-oracle';

    this.pollMs = Number.isFinite(config.pollMs) ? Math.max(250, Math.trunc(config.pollMs)) : 5000;
    this.debug = config.debug === true;

    const oracleOptions = config.oracleOptions && typeof config.oracleOptions === 'object' ? config.oracleOptions : {};
    this.oracle = config.oracle instanceof PriceOracle ? config.oracle : new PriceOracle(oracleOptions);

    this.started = false;
    this._timer = null;

    this.snapshot = null;
    this.lastError = null;
    this.lastTickAt = null;
  }

  getSnapshot() {
    return PriceOracle.cloneSnapshot(this.snapshot);
  }

  getStatus() {
    return {
      started: this.started,
      pollMs: this.pollMs,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      snapshotOk: this.snapshot ? this.snapshot.ok : false,
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this._tickAndSchedule().catch((err) => {
      this.lastError = err?.message ?? String(err);
      this.started = false;
      if (this.debug) console.error('[price] stopped:', this.lastError);
    });
  }

  stop() {
    this.started = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  async _tickOnce() {
    this.lastTickAt = nowMs();
    try {
      const snapshot = await this.oracle.tick();
      this.snapshot = snapshot;
      this.lastError = null;
      if (this.debug) {
        const okPairs = Object.entries(snapshot?.pairs || {})
          .map(([pair, v]) => `${pair}:${v?.ok ? 'ok' : 'bad'}`)
          .join(',');
        console.log(`[price] tick ok=${snapshot?.ok ? 1 : 0} pairs=${okPairs}`);
      }
    } catch (err) {
      this.lastError = err?.message ?? String(err);
      if (this.debug) console.error('[price] tick error:', this.lastError);
    }
  }

  async _tickAndSchedule() {
    if (!this.started) return;
    await this._tickOnce();
    if (!this.started) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._tickAndSchedule().catch((err) => {
        this.lastError = err?.message ?? String(err);
        this.started = false;
        if (this.debug) console.error('[price] stopped:', this.lastError);
      });
    }, this.pollMs);
  }
}

export { PriceOracleFeature };
export default PriceOracleFeature;

