import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
const { MicPermission } = NativeModules;

export async function askMicPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return await MicPermission.request();
  }

  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}
