import { TextComposer, type ComposerProps } from './TextComposer';

/** Web: voice input is not offered (recording + upload is native-only); text, photos and Stop work the same. */
export function Composer({ busy, onSend, onStop, attach, canSendEmpty }: ComposerProps) {
  return <TextComposer busy={busy} onSend={onSend} onStop={onStop} attach={attach} canSendEmpty={canSendEmpty} />;
}