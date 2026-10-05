declare module '@mono.co/connect.js' {
  type MonoConnectOptions = {
    key: string
    scope: 'auth'
    data: { customer: { name: string; email: string } }
    reference?: string
    onSuccess: (result: { code?: string }) => void
    onClose?: () => void
    onLoad?: () => void
    onEvent?: (eventName: string, data: unknown) => void
  }
  export default class Connect {
    constructor(options: MonoConnectOptions)
    setup(config?: Record<string, unknown>): void
    open(): void
  }
}
