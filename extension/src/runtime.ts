function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendOnce<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp as T);
    });
  });
}

function isNoReceiver(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /receiving end does not exist|could not establish connection/i.test(msg);
}

/** Send a message to the service worker, retrying once if it was asleep. */
export async function send<T = unknown>(msg: unknown): Promise<T> {
  try {
    return await sendOnce<T>(msg);
  } catch (err) {
    if (!isNoReceiver(err)) throw err;
    await delay(80);
    return sendOnce<T>(msg);
  }
}
