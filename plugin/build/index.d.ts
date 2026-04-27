import type { ConfigPlugin } from '@expo/config-plugins';
type DeepgramPluginOptions = {
    microphonePermission?: string;
    backgroundAudio?: boolean;
};
declare const withDeepgram: ConfigPlugin<DeepgramPluginOptions | void>;
export default withDeepgram;
