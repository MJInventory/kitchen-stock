export function bindAuthenticatedBootstrap({
  hasSession,
  showApp,
  showLogin,
  load,
  onError
}) {
  if (!hasSession()) {
    showLogin();
    return;
  }
  showApp();
  Promise.resolve(load()).catch((error) => onError(error));
}
