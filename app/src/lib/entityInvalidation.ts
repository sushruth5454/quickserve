const requestTokenBrand: unique symbol = Symbol('RequestToken');

export type RequestToken = Readonly<{
  readonly [requestTokenBrand]: true;
}>;

export function createRequestEpoch(): {
  begin(contextKey: string): RequestToken;
  isCurrent(token: RequestToken): boolean;
  invalidate(): void;
} {
  let currentToken: RequestToken | null = null;

  return {
    begin(_contextKey: string): RequestToken {
      const token = Object.freeze({
        [requestTokenBrand]: true as const,
      }) as RequestToken;
      currentToken = token;
      return token;
    },
    isCurrent(token: RequestToken): boolean {
      return currentToken === token;
    },
    invalidate(): void {
      currentToken = null;
    },
  };
}
