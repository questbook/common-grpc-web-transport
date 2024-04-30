import { grpc } from '@improbable-eng/grpc-web'
import { SocketConfig } from './types'

export function makeFetchBasedTransport(
	{
		url,
		methodDefinition: { methodName },
		onEnd,
		onChunk,
		onHeaders,
	}: grpc.TransportOptions,
	{ logger }: SocketConfig
): grpc.Transport {
	const abortController = new AbortController()
	const reqStream = new TransformStream({
		transform(chunk, controller) {
			controller.enqueue(chunk)
		}
	})
	const writer = reqStream.writable.getWriter()

	logger = logger?.child({
		rpc: methodName,
		id: generateRequestId()
	})

	return {
		async sendMessage(msgBytes) {
			try {
				await writer.write(msgBytes)
			} catch(err) {
				console.error(err)
			}
		},
		async finishSend() {
			await writer.close()
		},
		async start(metadata) {
			const headers: { [key: string]: string } = {}
			metadata.forEach((key, values) => {
				headers[key] = values.join(', ')
			})

			try {
				const res = await fetch(
					url,
					{
						method: 'POST',
						headers: new Headers(headers),
						body: reqStream.readable,
						// @ts-ignore
						duplex: 'half'
					}
				)

				onHeaders(
					mapHeadersToMetadata(res.headers),
					res.status
				)

				if(res.body) {
					const reader = res.body.getReader()
					let done = false
					while(!done) {
						const { value, done: done_ } = await reader.read()
						done = done_
						if(value) {
							onChunk(value)
						}
					}
				}

				onEnd()
			} catch(err) {
				logger?.error({ err }, 'error in request')
				onEnd(err)
				try {
					await writer.close()
					await reqStream.readable.cancel()
				} catch(err) {
				}
			}
		},
		cancel() {
			logger?.trace('canceling request')
			abortController.abort()
		}
	}
}

function mapHeadersToMetadata(headers: Headers) {
	const metadata = new grpc.Metadata()
	headers.forEach((value, key) => {
		if(headers.hasOwnProperty(key)) {
			if(value !== undefined) {
				metadata.append(key, value)
			}
		}
	})

	return metadata
}

function generateRequestId() {
	return Math.random().toString(16).replace('.', '')
}