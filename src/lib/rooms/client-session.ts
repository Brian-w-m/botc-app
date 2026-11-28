const tabSessionKey = (code: string) =>
  `nightfall:session:${code.toUpperCase()}`;
const latestSessionKey = (code: string) =>
  `nightfall:reconnect:${code.toUpperCase()}`;
const namedSessionKey = (code: string, displayName: string) =>
  `nightfall:reconnect:${code.toUpperCase()}:${encodeURIComponent(displayName.trim().toLowerCase())}`;

export function rememberPlayerSession(
  code: string,
  displayName: string,
  token: string,
) {
  const normalizedCode = code.toUpperCase();
  window.sessionStorage.setItem(tabSessionKey(normalizedCode), token);
  window.localStorage.setItem(latestSessionKey(normalizedCode), token);
  window.localStorage.setItem(
    namedSessionKey(normalizedCode, displayName),
    token,
  );
}

export function getPlayerSession(code: string) {
  const normalizedCode = code.toUpperCase();
  const tabToken = window.sessionStorage.getItem(tabSessionKey(normalizedCode));
  if (tabToken) return tabToken;

  const savedToken = window.localStorage.getItem(
    latestSessionKey(normalizedCode),
  );
  if (savedToken)
    window.sessionStorage.setItem(tabSessionKey(normalizedCode), savedToken);
  return savedToken ?? "";
}

export function getNamedPlayerSession(code: string, displayName: string) {
  return window.localStorage.getItem(namedSessionKey(code, displayName));
}

export function forgetPlayerSession(code: string, displayName: string) {
  const normalizedCode = code.toUpperCase();
  const token = getPlayerSession(normalizedCode);
  window.sessionStorage.removeItem(tabSessionKey(normalizedCode));
  window.localStorage.removeItem(namedSessionKey(normalizedCode, displayName));
  if (
    token &&
    window.localStorage.getItem(latestSessionKey(normalizedCode)) === token
  ) {
    window.localStorage.removeItem(latestSessionKey(normalizedCode));
  }
}
