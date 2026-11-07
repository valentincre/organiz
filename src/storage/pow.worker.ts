import { solvePow } from './pow'

self.addEventListener('message', (event: MessageEvent<string>) => {
  self.postMessage({ nonce: solvePow(event.data) })
})
