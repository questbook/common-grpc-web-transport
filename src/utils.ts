import type { SocketConfig, TransportType } from './types'

export function detectEnvironment(): TransportType {
	if(typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
		return 'react-native'
	}

	if(typeof window !== 'undefined') {
		return 'browser'
	}

	return 'node'
}

export function getSocketConfig(type: Exclude<TransportType, 'browser'>): SocketConfig {
	if(type === 'node') {
		const { connect: connectNet } = require('net')
		const { connect: connectTLS } = require('tls')
		return {
			connectNet,
			connectTLS,
		}
	}

	const sockets = require('react-native-tcp-socket')
	return {
		connectNet: sockets.connect,
		connectTLS: sockets.connectTLS,
	}
}