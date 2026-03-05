declare module 'qz-tray' {
  const qz: {
    websocket: {
      connect(options?: Record<string, unknown>): Promise<void>
      disconnect(): Promise<void>
      isActive(): boolean
    }
    security: {
      setCertificatePromise(fn: (resolve: (cert: string) => void) => void | (() => Promise<string>)): void
      setSignaturePromise(fn: (toSign: string) => (resolve: (sig: string) => void) => void | (() => () => Promise<string>)): void
    }
    printers: {
      find(query?: string): Promise<string[] | string>
      getDefault(): Promise<string>
      details(): Promise<Record<string, unknown>[]>
      startListening(printers?: string | string[] | null): Promise<void>
      stopListening(): Promise<void>
    }
    configs: {
      create(printer: string, options?: Record<string, unknown>): unknown
      setDefaults(options: Record<string, unknown>): void
    }
    print(config: unknown, data: unknown[]): Promise<void>
  }
  export default qz
}
