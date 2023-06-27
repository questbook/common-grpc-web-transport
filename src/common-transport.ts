import { grpc } from '@improbable-eng/grpc-web'
import { makeSocketBasedTransport } from './make-socket-based-transport'
import type { TransportConfig } from './types'
import { detectEnvironment, getSocketConfig } from './utils'

export function CommonTransport(
	{ logger, type }: TransportConfig
): grpc.TransportFactory {
	if(!type) {
		type = detectEnvironment()
		logger?.debug(`detected environment: ${type}`)
	}

	if(type === 'browser') {
		return grpc.XhrTransport({})
	}

	const config = getSocketConfig(type)
	config.logger = logger

	return opts => makeSocketBasedTransport(opts, config)
}