import {
  commitIfCurrent,
  conversationLoadResult,
  conversationLoadState,
  createConversationGeneration,
  runIfAiEnabled,
  shouldAutoSend,
} from '../conversationState';

describe('assistant conversation state', () => {
  it('does not auto-send a search question while AI is off', () => {
    const transport = jest.fn();

    if (shouldAutoSend(false, 'find a plumber', false)) {
      runIfAiEnabled(false, transport);
    }

    expect(transport).not.toHaveBeenCalled();
  });

  it('starts an AI request only while the capability is enabled', () => {
    const transport = jest.fn(() => 'started');

    expect(runIfAiEnabled(true, transport)).toBe('started');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('aborts pending work and rejects its callback when AI turns off', () => {
    const generation = createConversationGeneration();
    const key = generation.current();
    const controller = new AbortController();
    const commit = jest.fn();
    generation.track(controller);

    generation.invalidate();

    expect(controller.signal.aborted).toBe(true);
    expect(commitIfCurrent(generation, key, commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('ignores conversation A after conversation B starts loading', () => {
    const generation = createConversationGeneration();
    const a = generation.begin();
    const b = generation.begin();
    const commitA = jest.fn();
    const commitB = jest.fn();

    expect(commitIfCurrent(generation, a, commitA)).toBe(false);
    expect(commitIfCurrent(generation, b, commitB)).toBe(true);
    expect(commitA).not.toHaveBeenCalled();
    expect(commitB).toHaveBeenCalledTimes(1);
  });

  it('ignores an auto-resume result after New chat starts', () => {
    const generation = createConversationGeneration();
    const resume = generation.begin();
    const newChat = generation.begin();
    const commitResume = jest.fn();

    expect(commitIfCurrent(generation, resume, commitResume)).toBe(false);
    expect(generation.isCurrent(newChat)).toBe(true);
    expect(commitResume).not.toHaveBeenCalled();
  });

  it('does not attach a photo selected before New chat', () => {
    const generation = createConversationGeneration();
    const photoKey = generation.current();
    const attachPhoto = jest.fn();
    generation.begin();

    expect(commitIfCurrent(generation, photoKey, attachPhoto)).toBe(false);
    expect(attachPhoto).not.toHaveBeenCalled();
  });

  it('does not restore a voice transcription after New chat', () => {
    const generation = createConversationGeneration();
    const voiceKey = generation.current();
    const restoreVoice = jest.fn();
    generation.begin();

    expect(commitIfCurrent(generation, voiceKey, restoreVoice)).toBe(false);
    expect(restoreVoice).not.toHaveBeenCalled();
  });

  it('does not commit a draft reply from an older conversation', () => {
    const generation = createConversationGeneration();
    const request = generation.current();
    const commitDraft = jest.fn();
    generation.begin();

    expect(commitIfCurrent(generation, request, commitDraft)).toBe(false);
    expect(commitDraft).not.toHaveBeenCalled();
  });

  it('represents an empty selected conversation explicitly', () => {
    expect(conversationLoadResult('conversation-1', 0)).toEqual({
      status: 'empty',
      id: 'conversation-1',
      automatic: false,
    });
  });

  it('keeps failed selected-conversation loads identifiable for retry', () => {
    expect(conversationLoadState('conversation-2', 'error', true)).toEqual({
      status: 'error',
      id: 'conversation-2',
      automatic: true,
    });
  });
});
