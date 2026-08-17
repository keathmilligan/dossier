import { isDeniedUrl } from "./denylist";

export interface NavState {
  tabId: number;
  url: string;
  startedAt: number;
  captured: boolean;
}

export function shouldCaptureUrl(url: string, incognito: boolean): boolean {
  if (incognito) return false;
  if (!/^https?:/i.test(url)) return false;
  return !isDeniedUrl(url);
}

export function dwellElapsed(state: NavState, dwellMs: number, now = Date.now()): boolean {
  return !state.captured && now - state.startedAt >= dwellMs;
}
