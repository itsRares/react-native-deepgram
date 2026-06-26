"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("@expo/config-plugins");
const withAndroidDeepgram = (config, options = {}) => {
    const resolvedOptions = (options ?? {});
    return (0, config_plugins_1.withAndroidManifest)(config, (cfg) => {
        const recordPermission = 'android.permission.RECORD_AUDIO';
        const foregroundServicePermission = 'android.permission.FOREGROUND_SERVICE';
        const foregroundMicPermission = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
        const foregroundPlaybackPermission = 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK';
        const bluetoothConnectPermission = 'android.permission.BLUETOOTH_CONNECT';
        const legacyBluetoothPermission = 'android.permission.BLUETOOTH';
        const { manifest } = cfg.modResults;
        const permissions = manifest['uses-permission'] ?? [];
        const ensurePermission = (permission) => {
            if (!permissions.some((p) => p.$?.['android:name'] === permission)) {
                permissions.push({ $: { 'android:name': permission } });
            }
        };
        ensurePermission(recordPermission);
        // Bluetooth output routing. BLUETOOTH_CONNECT is a runtime permission on
        // Android 12+ (the app requests it); the legacy BLUETOOTH permission,
        // capped at API 30, covers the SCO path on older devices.
        ensurePermission(bluetoothConnectPermission);
        if (!permissions.some((p) => p.$?.['android:name'] === legacyBluetoothPermission)) {
            // maxSdkVersion isn't in the typed attribute set, so assert the entry
            // shape; the manifest serializer preserves arbitrary string attributes.
            permissions.push({
                $: {
                    'android:name': legacyBluetoothPermission,
                    'android:maxSdkVersion': '30',
                },
            });
        }
        if (resolvedOptions.backgroundAudio !== false) {
            ensurePermission(foregroundServicePermission);
            ensurePermission(foregroundMicPermission);
            ensurePermission(foregroundPlaybackPermission);
        }
        manifest['uses-permission'] = permissions;
        return cfg;
    });
};
const withIosDeepgram = (config, options = {}) => {
    return (0, config_plugins_1.withInfoPlist)(config, (cfg) => {
        cfg.modResults.NSMicrophoneUsageDescription =
            options.microphonePermission ??
                cfg.modResults.NSMicrophoneUsageDescription ??
                'Allow $(PRODUCT_NAME) to access the microphone';
        if (options.backgroundAudio !== false) {
            const modes = cfg.modResults.UIBackgroundModes ?? [];
            if (!modes.includes('audio')) {
                modes.push('audio');
            }
            cfg.modResults.UIBackgroundModes = modes;
        }
        return cfg;
    });
};
const withDeepgram = (config, options) => (0, config_plugins_1.withPlugins)(config, [
    [withAndroidDeepgram, options],
    [withIosDeepgram, options],
]);
exports.default = withDeepgram;
