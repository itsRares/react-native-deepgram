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
        const { manifest } = cfg.modResults;
        const permissions = manifest['uses-permission'] ?? [];
        const ensurePermission = (permission) => {
            if (!permissions.some((p) => p.$?.['android:name'] === permission)) {
                permissions.push({ $: { 'android:name': permission } });
            }
        };
        ensurePermission(recordPermission);
        if (resolvedOptions.backgroundAudio !== false) {
            ensurePermission(foregroundServicePermission);
            ensurePermission(foregroundMicPermission);
            ensurePermission(foregroundPlaybackPermission);
            // The library manifest ships DeepgramAudioService without
            // android:foregroundServiceType (Play Console justification opt-in);
            // enabling background audio merges the type back onto the service.
            const application = manifest.application?.[0];
            if (application) {
                const serviceName = 'com.deepgram.DeepgramAudioService';
                const services = (application.service ?? []);
                let service = services.find((s) => s.$?.['android:name'] === serviceName);
                if (!service) {
                    service = { $: { 'android:name': serviceName } };
                    services.push(service);
                }
                service.$['android:foregroundServiceType'] = 'microphone|mediaPlayback';
                application.service = services;
            }
        }
        manifest['uses-permission'] = permissions;
        const notification = resolvedOptions.androidNotification;
        if (notification) {
            const application = manifest.application?.[0];
            if (application) {
                const metaData = application['meta-data'] ?? [];
                const setMetaData = (name, value) => {
                    if (!value)
                        return;
                    const existing = metaData.find((m) => m.$?.['android:name'] === name);
                    if (existing) {
                        existing.$['android:value'] = value;
                    }
                    else {
                        metaData.push({
                            $: { 'android:name': name, 'android:value': value },
                        });
                    }
                };
                setMetaData('com.deepgram.notification.TITLE', notification.title);
                setMetaData('com.deepgram.notification.TEXT', notification.text);
                setMetaData('com.deepgram.notification.CHANNEL_NAME', notification.channelName);
                setMetaData('com.deepgram.notification.ICON', notification.icon);
                application['meta-data'] = metaData;
            }
        }
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
