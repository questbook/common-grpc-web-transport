import type * as http from 'http'
import { HTTPParser } from 'http-parser-js'
import { SocketConfig } from './types'

export type HTTPRequest = ReturnType<typeof makeHttpRequest>

export function makeHttpRequest(
	opts: http.RequestOptions & {
    secure: boolean
    log?: boolean
  } & SocketConfig
) {
	const defaultPort = opts.secure ? 443 : 80
	const log = opts.log ?? false
	const lines = [
		`${opts.method} ${opts.path} HTTP/1.1`,
		`Host: ${opts.host}`,
	]
	const resParser = new HTTPParser(HTTPParser.RESPONSE)
  const connect = opts.secure
    ? opts.connectTLS
    : opts.connectNet
	const netSocket = connect(
    {
      host: opts.host!,
      port: opts.port ? +opts.port : defaultPort,
      noDelay: true,
      keepAlive: true,
    },
    onConnect
  )

	if(opts.secure && log) {
		console.log('secure')
	}

	let pendingWrites: (Uint8Array | string)[] = []

	let sentInit = false
	let sentContentLengthHeader = false

	for(const key in opts.headers) {
		writeHeader(key, `${opts.headers[key]}`)
	}

	resParser.onBody = (chunk, offset, length) => {
		chunk = chunk.subarray(offset, offset + length)
		if(log) {
			console.log('recv body', chunk)
		}

		// const data =
		netSocket.emit('data-http', chunk)
	}

	resParser.onHeadersComplete = (info) => {
		const headers: { [_: string]: string } = {}
		for(let i = 0;i < info.headers.length;i += 2) {
			headers[info.headers[i].toString()] = info.headers[i + 1].toString()
		}

		if(log) {
			console.log('recv headers', info.statusCode, headers)
		}

		netSocket.emit(
			'headers',
			info.statusCode,
			headers,
		)
	}

	resParser.onMessageComplete = () => {
		if(log) {
			console.log('recv end')
		}

		netSocket.emit('end-http')
	}

	netSocket.on('data', data => {
		if(log) {
			console.log('recv ', data.toString())
		}

		resParser.execute(data)
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
			netSocket.end()
		},
		destroy() {
			netSocket.destroy()
		},
		write,
		writeHeader,
	}

	function write(content: Uint8Array | string) {
		if(!sentContentLengthHeader) {
			writeHeader('transfer-encoding', 'chunked')
		}

		if(!sentInit) {
			const initData = lines.join('\r\n') + '\r\n\r\n'
			if(log) {
				console.log('sent init data', initData)
			}

			writeToSocket(initData)
			sentInit = true
		}

		if(!sentContentLengthHeader) {
			writeToSocket(`${content.length.toString(16)}\r\n`)
		}

		writeToSocket(content)
		if(!sentContentLengthHeader) {
			writeToSocket('\r\n0\r\n\r\n')
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
		if(netSocket.connecting) {
			pendingWrites.push(buff)
		} else {
			netSocket.write(buff)
		}
	}

	function onConnect() {
    netSocket.setNoDelay(true)
    netSocket.setKeepAlive(true)
		for(const pendingWrite of pendingWrites) {
			netSocket.write(pendingWrite)
		}

		pendingWrites = []
	}
}