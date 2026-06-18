export function backendUrl(path: string) {
  const base = process.env.HEALTH_API_URL || "http://127.0.0.1:8000";
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
