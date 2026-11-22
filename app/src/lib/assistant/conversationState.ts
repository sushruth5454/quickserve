export type ConversationLoadPhase = 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

export type ConversationLoadState =
  | { status: 'idle' }
  | { status: ConversationLoadPhase; id: string; automatic: boolean };

export const idleConversationLoad: ConversationLoadState = { status: 'idle' };

export function conversationLoadState(id: string, status: ConversationLoadPhase, automatic = false): ConversationLoadState {
  return { status, id, automatic };
}

export function conversationLoadResult(id: string, turnCount: number, automatic = false): ConversationLoadState {
  return conversationLoadState(id, turnCount > 0 ? 'ready' : 'empty', automatic);
}

export function shouldAutoSend(aiEnabled: boolean, question: string | undefined, alreadySent: boolean): boolean {
  return aiEnabled && !alreadySent && !!question?.trim();
}

export function runIfAiEnabled<T>(aiEnabled: boolean, start: () => T): T | null {
  return aiEnabled ? start() : null;
}

export class ConversationGeneration {
  private value = 0;
  private readonly controllers = new Set<AbortController>();

  current(): number {
    return this.value;
  }

  isCurrent(key: number): boolean {
    return key === this.value;
  }

  begin(): number {
    return this.invalidate();
  }

  invalidate(): number {
    this.value += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    return this.value;
  }

  track(controller: AbortController): () => void {
    this.controllers.add(controller);
    return () => this.controllers.delete(controller);
  }
}

export function createConversationGeneration(): ConversationGeneration {
  return new ConversationGeneration();
}

export function commitIfCurrent(generation: ConversationGeneration, key: number, commit: () => void): boolean {
  if (!generation.isCurrent(key)) return false;
  commit();
  return true;
}
