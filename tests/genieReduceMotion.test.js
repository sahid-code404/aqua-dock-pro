import { GenieController } from '../effects/genie/genieEffect.js';
import { setReduceMotionOverride } from '../core/utils.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const config = {
    enableGenieEffect: true,
    reduceMotion: true,
};
const genie = new GenieController({
    getConfig: () => config,
});

try {
    // Reduce Motion is an AquaDock motion policy, not permission to tear down
    // the icon-geometry contract used by external Genie/Magic Lamp effects.
    setReduceMotionOverride(true);
    assert(genie.enabled === true,
        'Reduce Motion unexpectedly disabled Genie/Magic Lamp integration');

    config.enableGenieEffect = false;
    assert(genie.enabled === false,
        'the explicit Genie effect switch no longer controls the integration');
} finally {
    setReduceMotionOverride(false);
    genie.destroy();
}

print('genieReduceMotion: ok');
