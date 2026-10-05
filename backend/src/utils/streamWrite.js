export class ClientDisconnectedError extends Error {
  constructor() {
    super('Client disconnected');
    this.name = 'ClientDisconnectedError';
  }
}

/** How long one chunk may wait for a stalled reader before the response is dropped. */
export const STREAM_DRAIN_TIMEOUT_MS = 30 * 1000;

export function isClientGone(res) {
  return Boolean(res.destroyed || res.writableEnded || res.socket?.destroyed);
}

/**
 * Writes one chunk honoring backpressure. Throws ClientDisconnectedError once the client has
 * gone so export loops stop querying the database and release their report slot.
 */
export async function writeChunk(res, chunk) {
  if (isClientGone(res)) throw new ClientDisconnectedError();
  if (!res.write(chunk)) {
    await new Promise((resolve) => {
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.once('drain', done);
      res.once('close', done);
      // A client that stops reading must not hold a report slot forever.
      timer = setTimeout(() => {
        res.destroy();
        done();
      }, STREAM_DRAIN_TIMEOUT_MS);
    });
  }
  if (isClientGone(res)) throw new ClientDisconnectedError();
}

/** Runs a streaming export; a client disconnect ends quietly instead of surfacing as a 500. */
export async function runStreamingExport(res, task) {
  try {
    await task();
  } catch (err) {
    if (err instanceof ClientDisconnectedError) {
      if (!res.writableEnded) res.end();
      return;
    }
    throw err;
  }
}
