import type { Socket, SocketConnectOpts } from 'net'
import type { TLSSocket, TLSSocketOptions } from 'tls'

export type SocketConfig = {
	connectTLS(opts: TLSSocketOptions, onConnect: () => void): TLSSocket
	connectNet(opts: SocketConnectOpts, onConnect: () => void): Socket
}