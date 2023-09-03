import type * as http from 'http'
import type { HTTPParserJS as HTTPParserType } from 'http-parser-js'
import type { Logger, SocketConfig } from './types'

export type HTTPRequest = ReturnType<typeof makeHttpRequest>

type SocketState = 'connecting' | 'connected' | 'closed'

type MakeHTTPRequestOptions = http.RequestOptions & {
	/** Whether to use TLS or not */
    secure: boolean
    logger?: Logger
  } & SocketConfig

/**
 * Creates an HTTP request & sends it over a socket
 */
export function makeHttpRequest(
	{
		secure,
		method,
		path,
		host,
		port,
		logger,
		headers,
		connectNet,
		connectTLS
	}: MakeHTTPRequestOptions
) {
	const defaultPort = secure ? 443 : 80
	const lines = [
		`${method} ${path} HTTP/1.1`,
		`Host: ${host}`,
	]
	// import here to avoid bundling http-parser-js in the browser
	const { HTTPParser } = require('http-parser-js')
	const resParser = new HTTPParser(HTTPParser.RESPONSE) as HTTPParserType
	const connect = secure ? connectTLS : connectNet
	const netSocket = connect(
		{
			host: host!,
			port: port ? +port : defaultPort,
			noDelay: true,
			keepAlive: true,
		},
		() => {}
	)
	netSocket.setTimeout(10_000)

	netSocket.on('connect', onConnect)

	logger?.trace(`connecting over ${secure ? 'tls' : 'tcp'}`)

	let pendingWrites: (Uint8Array | string)[] = []
	let pendingEnd = false

	let sentInit = false
	let sentContentLengthHeader = false
	let state: SocketState = 'connecting'

	for(const key in headers) {
		writeHeader(key, `${headers[key]}`)
	}

	resParser.onBody = (chunk, offset, length) => {
		chunk = chunk.subarray(offset, offset + length)
		netSocket.emit('data-http', chunk)
	}

	resParser.onHeadersComplete = (info) => {
		const headers: { [_: string]: string } = {}
		for(let i = 0;i < info.headers.length;i += 2) {
			headers[info.headers[i].toString()] =
				info.headers[i + 1].toString()
		}

		logger?.trace(
			{ statusCode: info.statusCode, headers },
			'recv headers'
		)

		netSocket.emit('headers', info.statusCode, headers)
	}

	resParser.onMessageComplete = () => {
		logger?.trace('http request complete')
		handleSocketEnd()
	}

	netSocket.on('data', data => {
		logger?.trace({ data: data.toString() }, 'recv raw data')
		resParser.execute(data)
	})

	netSocket.on('error', (err) => {
		logger?.trace({ err }, 'socket error')
		handleSocketEnd()
	})

	return {
		onError(callback: (err: Error) => void) {
			netSocket.on('error', callback)
		},
		onHeaders(callback: (statusCode: number, headers: { [_: string]: string | string[] }) => void) {
			netSocket.on('headers', callback)
		},
		onData(callback: (buff: Buffer) => void) {
			netSocket.on('data-http', callback)
		},
		onEnd(callback: () => void) {
			netSocket.on('end-http', callback)
		},
		end() {
			if(state === 'connecting') {
				logger?.trace('pending end')
				pendingEnd = true
			} else if(state === 'connected') {
				netSocket.end()
			}
		},
		destroy() {
			netSocket.destroy()
		},
		write,
		writeHeader,
		finishWrite,
	}

	function handleSocketEnd() {
		state = 'closed'
		netSocket.emit('end-http')
		netSocket.end()
	}

	function write(content: Uint8Array | string) {
		if(!sentContentLengthHeader) {
			writeHeader('Transfer-Encoding', 'chunked')
		}

		if(!sentInit) {
			const initData = lines.join('\r\n') + '\r\n\r\n'
			logger?.trace({ initData }, 'sent init data')

			writeToSocket(initData)
			sentInit = true
		}

		if(!sentContentLengthHeader) {
			writeToSocket(`${content.length.toString(16)}\r\n`)
		}

		writeToSocket(content)
		if(!sentContentLengthHeader) {
			writeToSocket('\r\n')
		}
	}

	function finishWrite() {
		if(!sentContentLengthHeader) {
			writeToSocket('0\r\n\r\n')
		}
	}

	function writeHeader(key: string, value: string) {
		if(sentInit) {
			throw new Error('Cannot write header after init')
		}

		if(key.toLowerCase() === 'content-length') {
			sentContentLengthHeader = true
		}

		lines.push(`${key}: ${value}`)
	}

	function writeToSocket(buff: Uint8Array | string) {
		if(state === 'closed') {
			throw new Error('Socket is closed')
		}

		if(state === 'connected') {
			netSocket.write(buff)
		} else {
			pendingWrites.push(buff)
		}
	}

	function onConnect() {
		logger?.trace({ host, port }, 'connected')
		state = 'connected'

		for(let i = 0;i < pendingWrites.length;i++) {
			netSocket.write(pendingWrites[i])
		}

		pendingWrites = []
		if(pendingEnd) {
			state = 'closed'
		}
	}
}