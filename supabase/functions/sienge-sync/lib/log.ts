export type LogLevel = "info" | "warn" | "error" | "debug"

export function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}
