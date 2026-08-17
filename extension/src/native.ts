const HOST = "com.dossier.native";

export async function nativeGetToken(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: "get_token" }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const token = (resp as { token?: string } | undefined)?.token;
        resolve(token ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}
