import { peakTierThresholds, usePeakTier } from '../dock/iconResolution.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const zoom = 2.6;
const thresholds = peakTierThresholds(zoom);
assert(Math.abs(thresholds.boundary - Math.sqrt(zoom)) < 1e-12,
    'tier boundary should balance rest and peak texture scaling');
assert(!usePeakTier(1, thresholds, false, true), 'resting icons must use the native rest texture');
assert(usePeakTier(zoom, thresholds, false, true), 'fully magnified icons must use the native peak texture');
assert(!usePeakTier(thresholds.boundary, thresholds, false),
    'lower tier should remain stable inside hysteresis');
assert(usePeakTier(thresholds.boundary, thresholds, true),
    'upper tier should remain stable inside hysteresis');
assert(!usePeakTier(1, peakTierThresholds(1), true, true),
    'disabled magnification needs only one texture tier');

const narrow = peakTierThresholds(1.01);
assert(usePeakTier(1.01, narrow), 'a narrow zoom range must still reach its peak texture');
assert(!usePeakTier(1, narrow, true), 'a narrow zoom range must return to its rest texture');

const reused = {};
assert(peakTierThresholds(zoom, reused) === reused,
    'relayout should update thresholds without allocating');

print('iconResolution: ok');
