import type { Socket, SocketConnectOpts } from 'net'
import type { TLSSocket, TLSSocketOptions } from 'tls'

export type Logger = Pick<typeof console, 'trace' | 'debug' | 'info' | 'warn' | 'error'>
	& {
		child: (opts: { [_: string]: any }) => Logger
	}

export type SocketConfig = {
	/** create a TLS socket */
	connectTLS(opts: TLSSocketOptions, onConnect: () => void): TLSSocket
	/** create an insecure TCP socket */
	connectNet(opts: SocketConnectOpts, onConnect: () => void): Socket
	logger?: Logger
}

export type TransportType = 'node' | 'react-native' | 'browser'

export type TransportConfig = {
	/**
	 * specify which transport to use.
	 * Leave undefined to automatically detect.
	 * */
	type?: TransportType
	logger?: Logger
}