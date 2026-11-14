/**
 * Incremental parser for server-sent events (`data: …` lines, blank-line separated, `:` comments ignored). Chunks can
 * split anywhere, including between CR and LF.
 */
export function createSseParser(onData: (data: string) => void) {
  let buf = '';
  let pendingCR = false;
  const emit = (block: string) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      let s = (pendingCR ? '\r' : '') + chunk;
      pendingCR = s.endsWith('\r');
      if (pendingCR) s = s.slice(0, -1);
      buf += s.replace(/\r\n?/g, '\n');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        emit(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    },
    end() {
      if (pendingCR) buf += '\n';
      pendingCR = false;
      if (buf.trim()) emit(buf);
      buf = '';
    },
  };
}
