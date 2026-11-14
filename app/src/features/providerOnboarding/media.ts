/** Photo/document picking with client-side resize. Limits match the storage buckets (lib/onboarding/validation.ts). */
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { checkUpload } from '../../lib/onboarding/validation';

export interface PickedFile {
  uri: string;
  mimeType: string;
  size: number | null;
  name?: string;
}

async function resize(uri: string, maxWidth: number, quality: number): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: maxWidth });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  let size: number | null = null;
  try {
    size = (await (await fetch(out.uri)).blob()).size;
  } catch {
    size = null;
  }
  return { uri: out.uri, mimeType: 'image/jpeg', size };
}

/** Camera or gallery; square crop for avatars. Returns null when cancelled; throws a user-facing message on errors. */
export async function pickPhoto(kind: 'avatar' | 'portfolio', source: 'camera' | 'library'): Promise<PickedFile | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow camera access in Settings, or choose a photo from your gallery.');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: kind === 'avatar',
    aspect: kind === 'avatar' ? [1, 1] : undefined,
    quality: 0.9,
  };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const file = await resize(asset.uri, kind === 'avatar' ? 512 : 1280, kind === 'avatar' ? 0.75 : 0.7);
  const problem = checkUpload(kind, file.mimeType, file.size);
  if (problem) throw new Error(problem);
  return file;
}

export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const mimeType = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const problem = checkUpload('document', mimeType, asset.size ?? null);
  if (problem) throw new Error(problem);
  return { uri: asset.uri, mimeType, size: asset.size ?? null, name: asset.name };
}
