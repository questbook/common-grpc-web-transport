import type { Socket } from 'net'
import type { TLSSocket } from 'tls'

export type SocketConfig = {
	makeTLSSocket: (socket: Socket) => TLSSocket
	makeSocket: () => Socket
}