import { grpc } from '@improbable-eng/grpc-web'
import URL from 'url'
import { HTTPRequest, makeHttpRequest } from './make-http-request'
import type { SocketConfig } from './types'

type TransportConfig = SocketConfig

export function CommonTransport(config: TransportConfig): grpc.TransportFactory {
	return opts => makeTransport(opts, config)
}

function makeTransport(
	options: grpc.TransportOptions,
	config: TransportConfig
): grpc.Transport {
	let request: HTTPRequest | undefined

	return {
		sendMessage(msgBytes: Uint8Array) {
			if(!options.methodDefinition.requestStream && !options.methodDefinition.responseStream) {
        // Disable chunked encoding if we are not using streams
        request!.writeHeader('Content-Length', msgBytes.byteLength.toString())
			}

      request!.write(msgBytes)
      request!.end()
		},
		finishSend() {

		},
		start(metadata: grpc.Metadata) {
			const headers: { [key: string]: string } = {}
			metadata.forEach((key, values) => {
				headers[key] = values.join(', ')
			})
			const parsedUrl = URL.parse(options.url)

			request = makeHttpRequest({
				host: parsedUrl.hostname,
				port: parsedUrl.port ? parseInt(parsedUrl.port) : undefined,
				path: parsedUrl.path,
				headers: headers,
				method: 'POST',
				log: options.methodDefinition.responseStream,
				secure: parsedUrl.protocol === 'https:',
		    ...config
			})

			request.onError(err => {
				options.debug && console.log('NodeHttp.error', err)
				options.onEnd(err)
			})

			request.onHeaders((statusCode, _headers) => {
				const headers = filterHeadersForUndefined(_headers)
				options.onHeaders(new grpc.Metadata(headers), statusCode)
			})

			request.onData(chunk => {
				options.debug && console.log('NodeHttp.data', chunk)
				options.onChunk(chunk)
			})

			request.onEnd(() => {
				options.debug && console.log('NodeHttp.end')
				options.onEnd()
			})
		},
		cancel() {
			options.debug && console.log('NodeHttp.abort')
			request?.destroy()
		}
	}
}

function filterHeadersForUndefined(headers: {[key: string]: string | string[] | undefined}): {[key: string]: string | string[]} {
	const filteredHeaders: {[key: string]: string | string[]} = {}

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