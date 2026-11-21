export type AccessActorId = string | null;

export type AccessPresentation<T = never> =
  | { status: 'loading'; actorId: AccessActorId }
  | { status: 'error'; actorId: AccessActorId; message: string }
  | { status: 'denied'; actorId: AccessActorId }
  | { status: 'allowed'; actorId: AccessActorId }
  | { status: 'resolved'; actorId: AccessActorId; value: T };

export function loadingAccess(actorId: AccessActorId): AccessPresentation<never> {
  return { status: 'loading', actorId };
}

export function resolvedAccess<T>(actorId: AccessActorId, value: T): AccessPresentation<T> {
  return { status: 'resolved', actorId, value };
}

export function adminAccessResult(actorId: AccessActorId, allowed: boolean): AccessPresentation<never> {
  return allowed ? { status: 'allowed', actorId } : { status: 'denied', actorId };
}

export function accessError<T = never>(
  actorId: AccessActorId,
  error: unknown,
  fallbackMessage = 'Unable to verify access.',
): AccessPresentation<T> {
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return { status: 'error', actorId, message };
}

export function accessForActor<T>(
  access: AccessPresentation<T>,
  actorId: AccessActorId,
): AccessPresentation<T> {
  return access.actorId === actorId ? access : loadingAccess(actorId);
}

export function retryAccess<T>(
  access: AccessPresentation<T>,
  actorId: AccessActorId,
): AccessPresentation<T> {
  const currentAccess = accessForActor(access, actorId);
  return currentAccess.status === 'error' ? loadingAccess(actorId) : currentAccess;
}
