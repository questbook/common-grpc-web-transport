import type * as http from "http"
import { Socket } from 'net'
import { TLSSocket } from 'tls'
import URL from 'url'
import { grpc } from "@improbable-eng/grpc-web"
import { HTTPParser } from "http-parser-js"

export function CommonTransport(): grpc.TransportFactory {
  return makeTransport
}

function makeTransport(options: grpc.TransportOptions): grpc.Transport {
  let request: HTTPRequest | undefined

  return {
    sendMessage(msgBytes: Uint8Array) {
      if (!options.methodDefinition.requestStream  && !options.methodDefinition.responseStream) {
        // Disable chunked encoding if we are not using streams
        request!.writeHeader("Content-Length", msgBytes.byteLength.toString())
      }
      request!.write(msgBytes)
      request!.end()
    },
    finishSend() {

    },
    start(metadata: grpc.Metadata) {
      const headers: { [key: string]: string } = {}
      metadata.forEach((key, values) => {
        headers[key] = values.join(", ")
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
      })
  
      request.onError(err => {
        options.debug && console.log("NodeHttp.error", err)
        options.onEnd(err)
      })
  
      request.onHeaders((statusCode, _headers) => {
        const headers = filterHeadersForUndefined(_headers)
        options.onHeaders(new grpc.Metadata(headers), statusCode!)
      })
  
      request.onData(chunk => {
        options.debug && console.log("NodeHttp.data", chunk)
        options.onChunk(chunk)
      })
  
      request.onEnd(() => {
        options.debug && console.log("NodeHttp.end")
        options.onEnd()
      })
    },
    cancel() {
      options.debug && console.log("NodeHttp.abort")
      request?.destroy()
    }
  }
}

type HTTPRequest = ReturnType<typeof makeHttpRequest>

function makeHttpRequest(
  opts: http.RequestOptions & {
    secure: boolean
    log?: boolean
  }
) {
  const defaultPort = opts.secure ? 443 : 80
  const log = opts.log ?? false
  const lines = [
    `${opts.method} ${opts.path} HTTP/1.1`,
    `Host: ${opts.host}`,
  ]
  const resParser = new HTTPParser(HTTPParser.RESPONSE)

  const tcpSocket = new Socket()
  const netSocket = opts.secure
    ? new TLSSocket(tcpSocket)
    : tcpSocket

  if(opts.secure && log) {
    console.log('secure')
  }

  let pendingWrites: (Uint8Array | string)[] = []

  let sentInit = false
  let sentContentLengthHeader = false

  for(const key in opts.headers) {
    writeHeader(key, `${opts.headers[key]}`)
  }

  netSocket.connect(
    {
      host: opts.host!,
      port: opts.port ? +opts.port : defaultPort,
    },
    onConnect
  )

  resParser.onBody = (chunk, offset, length) => {
    chunk = chunk.subarray(offset, offset+length)
    if(log) {
      console.log('recv body', chunk)
    }
    // const data = 
    netSocket.emit('data-http', chunk)
  }

  resParser.onHeadersComplete = (info) => {
    const headers: { [_: string]: string } = {}
    for(let i = 0;i < info.headers.length;i+=2) {
      headers[info.headers[i].toString()] = info.headers[i+1].toString()
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
      writeToSocket(`\r\n0\r\n\r\n`)
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
    for(const pendingWrite of pendingWrites) {
      netSocket.write(pendingWrite)
    }

    pendingWrites = []
  }
}

function filterHeadersForUndefined(headers: {[key: string]: string | string[] | undefined}): {[key: string]: string | string[]} {
  const filteredHeaders: {[key: string]: string | string[]} = {}

  for (let key in headers) {
    const value = headers[key]
    if (headers.hasOwnProperty(key)) {
      if (value !== undefined) {
        filteredHeaders[key] = value
      }
    }
  }

  return filteredHeaders
}