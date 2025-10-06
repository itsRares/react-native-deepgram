"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("@expo/config-plugins");
const withAndroidDeepgram = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (cfg) => {
        const recordPermission = 'android.permission.RECORD_AUDIO';
        const { manifest } = cfg.modResults;
        const permissions = manifest['uses-permission'] ?? [];
        if (!permissions.some((p) => p.$?.['android:name'] === recordPermission)) {
            permissions.push({ $: { 'android:name': recordPermission } });
            manifest['uses-permission'] = permissions;
        }
        return cfg;
    });
};
const withIosDeepgram = (config, options = {}) => {
    const fallbackPermissionMessage = 'Allow $(PRODUCT_NAME) to access your microphone.';
    return (0, config_plugins_1.withInfoPlist)(config, (cfg) => {
        if (options.microphonePermission) {
            cfg.modResults.NSMicrophoneUsageDescription =
                options.microphonePermission;
        }
        else if (!cfg.modResults.NSMicrophoneUsageDescription) {
            cfg.modResults.NSMicrophoneUsageDescription = fallbackPermissionMessage;
        }
        return cfg;
    });
};
const withDeepgram = (config, options) => (0, config_plugins_1.withPlugins)(config, [
    [withAndroidDeepgram, options],
    [withIosDeepgram, options],
]);
exports.default = withDeepgram;