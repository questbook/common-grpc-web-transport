import { grpc } from '@improbable-eng/grpc-web'
import P from 'pino'
import URL from 'url'
import { HTTPRequest, makeHttpRequest } from './make-http-request'
import type { SocketConfig } from './types'

export function makeSocketBasedTransport(
	options: grpc.TransportOptions,
	config: SocketConfig
): grpc.Transport {
	const parsedUrl = URL.parse(options.url)
	let request: HTTPRequest | undefined
	const logger = (config.logger || P())
		.child({
			rpc: options.methodDefinition.methodName,
			id: generateRequestId()
		})
	// if we're in debug mode, set the logger to debug
	// if the logger is already set to debug, leave it
	if(options.debug && logger.levelVal > 10) {
		logger.level = 'trace'
	}

	return {
		sendMessage(msgBytes: Uint8Array) {
			if(
				!options.methodDefinition.requestStream
				&& !options.methodDefinition.responseStream
			) {
				logger.trace(
					{ length: msgBytes.byteLength },
					'set content length'
				)
				// Disable chunked encoding if we are not using streams
				request!.writeHeader(
					'Content-Length',
					msgBytes.byteLength.toString()
				)
			}

			request!.write(msgBytes)
		},
		finishSend() {
			logger.trace('finished write')
			request!.finishWrite()
			request!.end()
		},
		start(metadata: grpc.Metadata) {
			const headers: { [key: string]: string } = {}
			metadata.forEach((key, values) => {
				headers[key] = values.join(', ')
			})

			request = makeHttpRequest({
				host: parsedUrl.hostname,
				port: parsedUrl.port ? +parsedUrl.port : undefined,
				path: parsedUrl.path,
				headers: headers,
				method: 'POST',
				secure: parsedUrl.protocol === 'https:',
				...config,
				logger,
			})

			request.onError(err => {
				logger.error({ err }, 'error in request')
				options.onEnd(err)
			})

			request.onHeaders((statusCode, _headers) => {
				const headers = filterHeadersForUndefined(_headers)
				options.onHeaders(new grpc.Metadata(headers), statusCode)
			})

			request.onData(chunk => {
				logger.trace({ chunk: chunk.toString() }, 'received chunk')
				options.onChunk(chunk)
			})

			request.onEnd(() => {
				logger.trace('request ended')
				options.onEnd()
			})
		},
		cancel() {
			logger.trace('canceling request')
			request?.destroy()
		}
	}
}

function filterHeadersForUndefined(headers: { [key: string]: string | string[] | undefined }): { [key: string]: string | string[] } {
	const filteredHeaders: { [key: string]: string | string[] } = {}

	for(const key in headers) {
		const value = headers[key]
		if(headers.hasOwnProperty(key)) {
			if(value !== undefined) {
				filteredHeaders[key] = value
			}
		}
	}

	return filteredHeaders
}

function generateRequestId() {
	return Math.random().toString(16).replace('.', '')
}