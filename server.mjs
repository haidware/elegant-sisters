import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { handleAdminApi } from './server/admin-api.mjs'

if (process.env.NODE_ENV !== 'production') {
  try {
    process.loadEnvFile('.env.local')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

const distDirectory = resolve('dist')
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const server = createServer(async (request, response) => {
  let pathname
  let url
  try {
    url = new URL(request.url ?? '/', 'http://localhost')
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }

  if (await handleAdminApi(request, response, url)) return

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }

  const requestedFile = resolve(distDirectory, `.${pathname}`)
  if (requestedFile !== distDirectory && !requestedFile.startsWith(`${distDirectory}${sep}`)) {
    response.writeHead(404).end('Not found')
    return
  }

  try {
    let filePath = requestedFile
    let contents
    try {
      if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, 'index.html')
      contents = await readFile(filePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (extname(pathname)) {
        response.writeHead(404).end('Not found')
        return
      }
      filePath = resolve(distDirectory, 'index.html')
      contents = await readFile(filePath)
    }

    const isHtml = extname(filePath) === '.html'
    response.writeHead(200, {
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    })
    response.end(contents)
  } catch (error) {
    console.error('Unable to serve the requested file.', error)
    response.writeHead(500).end('Unable to serve this page')
  }
})

const port = Number(process.env.PORT ?? 3000)
server.listen(port, '0.0.0.0', () => {
  console.log(`Membergram is listening on port ${port}.`)
})
