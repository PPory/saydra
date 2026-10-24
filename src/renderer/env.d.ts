// Vite turns CSS imports into injected styles.
declare module '*.css'
// A worker or worklet bundled on its own, imported as its URL.
declare module '*?worker&url' {
  const url: string
  export default url
}
