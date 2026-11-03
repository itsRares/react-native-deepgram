import { Platform, PermissionsAndroid } from 'react-native';
import { Deepgram } from '../native';

export async function askMicPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return Deepgram.requestRecordPermission();
  }

  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO!
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}
