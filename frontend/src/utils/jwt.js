export function getTokenExpiry(token) {
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!decoded.exp) return null;
    return decoded.exp * 1000;
  } catch {
    return null;
  }
}
