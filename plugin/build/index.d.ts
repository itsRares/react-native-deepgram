import type { ConfigPlugin } from '@expo/config-plugins';
type DeepgramPluginOptions = {
    microphonePermission?: string;
    backgroundAudio?: boolean;
    /**
     * Customize the Android foreground-service (keep-alive) notification shown
     * while background audio is active. Values are written as
     * `com.deepgram.notification.*` <meta-data> entries in the manifest.
     */
    androidNotification?: {
        /** Notification title. Default: the app's label. */
        title?: string;
        /** Notification body text. */
        text?: string;
        /** Notification channel name (visible in system settings). Default: title. */
        channelName?: string;
        /** Drawable/mipmap resource name for the small icon, e.g. 'ic_stat_audio'. */
        icon?: string;
    };
};
declare const withDeepgram: ConfigPlugin<DeepgramPluginOptions | void>;
export default withDeepgram;
