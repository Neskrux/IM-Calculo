const isDev = import.meta.env.DEV
export const log = (...args) => isDev && console.log(...args)
export const warn = (...args) => isDev && console.warn(...args)
export const error = (...args) => console.error(...args)
