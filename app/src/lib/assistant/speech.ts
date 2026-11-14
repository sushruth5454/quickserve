/**
 * Optional read-aloud of assistant replies (off by default; header toggle). Uses the device's text-to-speech in the
 * reply's language; nothing is sent to a server.
 */
import * as Speech from 'expo-speech';
import type { AssistantLanguage } from './types';

export function speechLanguage(lang: AssistantLanguage | null | undefined): string {
  return lang === 'hi' || lang === 'hinglish' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
}

export function speak(text: string, lang: AssistantLanguage | null | undefined): void {
  const t = text.trim();
  if (!t) return;
  void Speech.stop().catch(() => undefined);
  Speech.speak(t, { language: speechLanguage(lang), rate: 1.0 });
}

export function stopSpeaking(): void {
  void Speech.stop().catch(() => undefined);
}
