import { TextComposer, type ComposerProps } from './TextComposer';

/** Web: voice input is not offered (recording + upload is native-only); text works the same. */
export function Composer({ busy, onSend }: ComposerProps) {
  return <TextComposer busy={busy} onSend={onSend} />;
}
