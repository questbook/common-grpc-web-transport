import { grpc } from '@improbable-eng/grpc-web'
import { makeFetchBasedTransport } from './make-fetch-based-transport'
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

	return opts => makeFetchBasedTransport(opts, config)
}