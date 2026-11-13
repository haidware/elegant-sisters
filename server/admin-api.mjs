import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const cookieName = 'membergram_admin_session'
const sessionLifetimeSeconds = 8 * 60 * 60
const maxJsonBytes = 64 * 1024
const maxImageBytes = 50 * 1024 * 1024
const maxVideoBytes = 50 * 1024 * 1024
const maxCatalogueImages = 10
const maxCatalogueVideos = 1
const maxMediaPerRequest = maxCatalogueImages + maxCatalogueVideos
const loginAttempts = new Map()
let cachedAdminClient
let cachedAdminConfig

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new ApiError(503, 'Admin service is not configured. Set SUPABASE_SERVICE_ROLE_KEY and ensure SUPABASE_URL or VITE_SUPABASE_URL is set in Railway.')
  }
  const configKey = `${url}:${serviceRoleKey}`
  if (cachedAdminClient && cachedAdminConfig === configKey) return cachedAdminClient
  cachedAdminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  cachedAdminConfig = configKey
  return cachedAdminClient
}

function getSessionSecret() {
  const secret = process.env.SUPER_USER_PASS_KEY
  if (!secret) throw new ApiError(503, 'Admin login is not configured in Railway.')
  return secret
}

function createSessionToken(expiresAt) {
  const signature = createHmac('sha256', getSessionSecret()).update(String(expiresAt)).digest('base64url')
  return `${expiresAt}.${signature}`
}

function hasValidSession(request) {
  const cookieHeader = request.headers.cookie ?? ''
  const cookieValue = cookieHeader.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!cookieValue) return false

  let decodedCookie
  try {
    decodedCookie = decodeURIComponent(cookieValue)
  } catch {
    return false
  }
  const [expiresAtText, signature] = decodedCookie.split('.')
  const expiresAt = Number(expiresAtText)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !signature) return false

  try {
    return safeEqual(signature, createHmac('sha256', getSessionSecret()).update(String(expiresAt)).digest('base64url'))
  } catch {
    return false
  }
}

function sessionCookie(token, maxAge, request) {
  const secure = process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
}

async function readJson(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxJsonBytes) throw new ApiError(413, 'Request body is too large.')
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object')
    return body
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.')
  }
}

function requireSameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ApiError(403, 'Cross-site admin requests are not allowed.')
  }
  const origin = request.headers.origin
  const forwardedHost = request.headers['x-forwarded-host']
  const hostHeader = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : request.headers.host
  if (origin && hostHeader) {
    let originHost
    try {
      originHost = new URL(origin).host
    } catch {
      throw new ApiError(403, 'Invalid request origin.')
    }
    if (originHost !== hostHeader) throw new ApiError(403, 'Cross-origin admin requests are not allowed.')
  }
}

function requireUuid(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `${label} is invalid.`)
  }
  return value
}

function getLoginAttempt(ip) {
  const now = Date.now()
  const attempt = loginAttempts.get(ip)
  if (!attempt || attempt.resetAt <= now) {
    const next = { count: 0, resetAt: now + 60_000 }
    loginAttempts.set(ip, next)
    return next
  }
  return attempt
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip)
}

function failLogin(ip) {
  const attempt = getLoginAttempt(ip)
  attempt.count += 1
  if (loginAttempts.size > 1000) {
    for (const [key, value] of loginAttempts) {
      if (value.resetAt <= Date.now()) loginAttempts.delete(key)
    }
  }
}

function slugify(value) {
  return value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function handleLogin(request, response) {
  const username = process.env.SUPER_USER_NAME
  const password = process.env.SUPER_USER_PASS_KEY
  if (!username || !password) throw new ApiError(503, 'Set SUPER_USER_NAME and SUPER_USER_PASS_KEY in Railway.')
  getAdminClient()

  const forwardedFor = request.headers['x-forwarded-for']
  const ip = typeof forwardedFor === 'string'
    ? forwardedFor.split(',').pop().trim()
    : request.socket.remoteAddress ?? 'unknown'
  const attempt = getLoginAttempt(ip)
  if (attempt.count >= 10) throw new ApiError(429, 'Too many sign-in attempts. Wait one minute and try again.')

  const body = await readJson(request)
  const usernameMatches = typeof body.username === 'string' && safeEqual(body.username, username)
  const passwordMatches = typeof body.password === 'string' && safeEqual(body.password, password)
  if (!usernameMatches || !passwordMatches) {
    failLogin(ip)
    throw new ApiError(401, 'Invalid superuser username or password.')
  }

  resetLoginAttempts(ip)
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
  sendJson(response, 200, { authenticated: true }, {
    'Set-Cookie': sessionCookie(createSessionToken(expiresAt), sessionLifetimeSeconds, request),
  })
}

async function handleAdminRequest(request, response, url) {
  const { pathname, searchParams } = url
  if (pathname === '/api/admin/session' && request.method === 'GET') {
    sendJson(response, 200, { authenticated: hasValidSession(request) })
    return
  }
  if (pathname === '/api/admin/login' && request.method === 'POST') {
    await handleLogin(request, response)
    return
  }
  if (pathname === '/api/admin/logout' && request.method === 'POST') {
    sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', 0, request) })
    return
  }

  if (!hasValidSession(request)) throw new ApiError(401, 'Your admin session has expired. Sign in again.')
  const client = getAdminClient()

  if (pathname === '/api/admin/groups' && request.method === 'GET') {
    const { data, error } = await client.from('groups')
      .select('id, slug, name, description, sort_order, published')
      .order('sort_order', { ascending: true })
    if (error) throw new ApiError(502, error.message)
    sendJson(response, 200, data)
    return
  }

  if (pathname === '/api/admin/groups' && request.method === 'POST') {
    const body = await readJson(request)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const slug = typeof body.slug === 'string' ? slugify(body.slug) : ''
    if (!name || !slug) throw new ApiError(400, 'Enter a group name that includes letters or numbers.')
    if (['admin', 'assets', 'groups'].includes(slug)) throw new ApiError(400, `"${slug}" is reserved for Membergram.`)
    const { data, error } = await client.from('groups').insert({
      name,
      slug,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      sort_order: Number.isInteger(body.sort_order) && body.sort_order >= 0 ? body.sort_order : 0,
      published: true,
    }).select('id').single()
    if (error) throw new ApiError(400, error.message)
    sendJson(response, 201, { id: data.id })
    return
  }

  if (pathname === '/api/admin/members' && request.method === 'GET') {
    const groupId = requireUuid(searchParams.get('groupId'), 'Group ID')
    const { data, error } = await client.from('members')
      .select('id, group_id, slug, full_name, role_title, bio, portrait_url, portrait_storage_path, media_ready, sort_order, published')
      .eq('group_id', groupId)
      .order('sort_order', { ascending: true })
    if (error) throw new ApiError(502, error.message)
    sendJson(response, 200, data)
    return
  }

  if (pathname === '/api/admin/members' && request.method === 'POST') {
    const body = await readJson(request)
    const groupId = requireUuid(body.group_id, 'Group ID')
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const slug = typeof body.slug === 'string' ? slugify(body.slug) : ''
    if (!fullName || !slug) throw new ApiError(400, 'Enter a member name that includes letters or numbers.')
    const { data, error } = await client.from('members').insert({
      group_id: groupId,
      full_name: fullName,
      slug,
      role_title: typeof body.role_title === 'string' ? body.role_title.trim() || 'Sister' : 'Sister',
      bio: typeof body.bio === 'string' ? body.bio.trim() || null : null,
      sort_order: Number.isInteger(body.sort_order) && body.sort_order >= 0 ? body.sort_order : 0,
      published: false,
      media_ready: false,
    }).select('id').single()
    if (error) throw new ApiError(400, error.message)
    sendJson(response, 201, { id: data.id })
    return
  }

  const memberMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)$/)
  if (memberMatch && request.method === 'PATCH') {
    const memberId = requireUuid(memberMatch[1], 'Member ID')
    const body = await readJson(request)
    if (typeof body.published !== 'boolean') throw new ApiError(400, 'Published must be true or false.')
    if (body.published) {
      const { data: member, error: memberError } = await client.from('members')
        .select('media_ready')
        .eq('id', memberId)
        .maybeSingle()
      if (memberError) throw new ApiError(502, memberError.message)
      if (!member) throw new ApiError(404, 'Member not found.')
      if (!member.media_ready) throw new ApiError(409, 'Finish uploading the member portrait and selected media before publishing.')
    }
    const { data, error } = await client.from('members').update({ published: body.published })
      .eq('id', memberId).select('id').maybeSingle()
    if (error) throw new ApiError(400, error.message)
    if (!data) throw new ApiError(404, 'Member not found.')
    sendJson(response, 200, { updated: true })
    return
  }

  const memberCompleteMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/complete$/)
  if (memberCompleteMatch && request.method === 'POST') {
    const memberId = requireUuid(memberCompleteMatch[1], 'Member ID')
    const { data: member, error: memberError } = await client.from('members')
      .select('portrait_url')
      .eq('id', memberId)
      .maybeSingle()
    if (memberError) throw new ApiError(502, memberError.message)
    if (!member) throw new ApiError(404, 'Member not found.')
    if (!member.portrait_url) throw new ApiError(409, 'Upload a tree portrait before publishing this member.')
    const { error } = await client.from('members')
      .update({ media_ready: true, published: true })
      .eq('id', memberId)
    if (error) throw new ApiError(502, error.message)
    sendJson(response, 200, { published: true })
    return
  }

  const memberPortraitMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/portrait$/)
  if (memberPortraitMatch && request.method === 'POST') {
    const memberId = requireUuid(memberPortraitMatch[1], 'Member ID')
    const body = await readJson(request)
    const path = body.path
    if (typeof path !== 'string' || !path.startsWith(`${memberId}/portrait/`) || path.includes('..')) {
      throw new ApiError(400, 'The tree portrait path is invalid.')
    }
    const { data: member, error: memberError } = await client.from('members')
      .select('portrait_storage_path')
      .eq('id', memberId)
      .maybeSingle()
    if (memberError) throw new ApiError(502, memberError.message)
    if (!member) throw new ApiError(404, 'Member not found.')
    const bucket = client.storage.from('member-photos')
    const portraitUrl = bucket.getPublicUrl(path).data.publicUrl
    const { error } = await client.from('members')
      .update({ portrait_url: portraitUrl, portrait_storage_path: path })
      .eq('id', memberId)
    if (error) throw new ApiError(502, error.message)
    if (member.portrait_storage_path && member.portrait_storage_path !== path) {
      const { error: cleanupError } = await bucket.remove([member.portrait_storage_path])
      if (cleanupError) console.error('Unable to remove the replaced member portrait.', cleanupError)
    }
    sendJson(response, 200, { portrait_url: portraitUrl })
    return
  }

  if (pathname === '/api/admin/media/sign' && request.method === 'POST') {
    const body = await readJson(request)
    const memberId = requireUuid(body.memberId, 'Member ID')
    const purpose = body.purpose
    if (purpose !== 'portrait' && purpose !== 'catalogue') {
      throw new ApiError(400, 'Choose portrait or catalogue media.')
    }
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > (purpose === 'portrait' ? 1 : maxMediaPerRequest)) {
      throw new ApiError(400, purpose === 'portrait' ? 'Choose one tree portrait.' : `Choose up to ${maxMediaPerRequest} catalogue files at a time.`)
    }
    const { data: member, error: memberError } = await client.from('members').select('id').eq('id', memberId).maybeSingle()
    if (memberError) throw new ApiError(502, memberError.message)
    if (!member) throw new ApiError(404, 'Member not found.')

    const files = body.files.map((file) => {
      const mediaType = file?.media_type
      if (typeof file?.name !== 'string' || typeof file?.type !== 'string') {
        throw new ApiError(400, 'Each upload needs a file name and media type.')
      }
      if (purpose === 'portrait' && (mediaType !== 'image' || !file.type.startsWith('image/'))) {
        throw new ApiError(400, 'The tree portrait must be an image.')
      }
      if (purpose === 'catalogue' && mediaType === 'image' && !file.type.startsWith('image/')) {
        throw new ApiError(400, 'Catalogue photos must be image files.')
      }
      if (purpose === 'catalogue' && mediaType === 'video' && !file.type.startsWith('video/')) {
        throw new ApiError(400, 'Catalogue videos must be video files.')
      }
      if (purpose === 'catalogue' && mediaType !== 'image' && mediaType !== 'video') {
        throw new ApiError(400, 'Catalogue files must be images or videos.')
      }
      const maxBytes = mediaType === 'video' ? maxVideoBytes : maxImageBytes
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) {
        throw new ApiError(400, 'Each image or video must be 50 MB or smaller.')
      }
      let durationSeconds = null
      if (mediaType === 'video') {
        durationSeconds = Number(file.duration_seconds)
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 180) {
          throw new ApiError(400, 'Each video must be 3 minutes or shorter.')
        }
      }
      return { ...file, mediaType, durationSeconds }
    })

    if (purpose === 'portrait' && files.length !== 1) throw new ApiError(400, 'Choose one tree portrait.')
    if (purpose === 'catalogue') {
      const imageCount = files.filter((file) => file.mediaType === 'image').length
      const videoCount = files.filter((file) => file.mediaType === 'video').length
      if (imageCount > maxCatalogueImages || videoCount > maxCatalogueVideos) {
        throw new ApiError(400, 'A member can have up to 10 catalogue photos and one video.')
      }
      const { data: currentMedia, error: mediaError } = await client.from('member_photos')
        .select('media_type')
        .eq('member_id', memberId)
      if (mediaError) throw new ApiError(502, mediaError.message)
      const existingImages = (currentMedia ?? []).filter((item) => item.media_type === 'image').length
      const existingVideos = (currentMedia ?? []).filter((item) => item.media_type === 'video').length
      if (existingImages + imageCount > maxCatalogueImages) throw new ApiError(409, 'A member can have up to 10 catalogue photos.')
      if (existingVideos + videoCount > maxCatalogueVideos) throw new ApiError(409, 'A member can have only one catalogue video.')
    }

    const bucket = client.storage.from('member-photos')
    const uploads = []
    for (const file of files) {
      const extension = file.name.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? 'image'
      const folder = purpose === 'portrait' ? 'portrait' : 'catalogue'
      const path = `${memberId}/${folder}/${randomUUID()}.${extension}`
      const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false })
      if (error) throw new ApiError(502, error.message)
      uploads.push({
        path,
        token: data.token,
        name: file.name,
        type: file.type,
        media_type: file.mediaType,
        duration_seconds: file.durationSeconds,
      })
    }
    sendJson(response, 200, { uploads })
    return
  }

  if (pathname === '/api/admin/media/register' && request.method === 'POST') {
    const body = await readJson(request)
    const memberId = requireUuid(body.memberId, 'Member ID')
    if (!Array.isArray(body.uploads) || body.uploads.length < 1 || body.uploads.length > maxMediaPerRequest) {
      throw new ApiError(400, 'No uploaded catalogue media were provided.')
    }
    const uploads = body.uploads.map((upload) => {
      if (typeof upload?.path !== 'string' || !upload.path.startsWith(`${memberId}/catalogue/`) || upload.path.includes('..')) {
        throw new ApiError(400, 'An uploaded catalogue media path is invalid.')
      }
      if (upload.media_type !== 'image' && upload.media_type !== 'video') {
        throw new ApiError(400, 'Catalogue files must be images or videos.')
      }
      let durationSeconds = null
      if (upload.media_type === 'video') {
        durationSeconds = Number(upload.duration_seconds)
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 180) {
          throw new ApiError(400, 'Each video must be 3 minutes or shorter.')
        }
      }
      return { path: upload.path, mediaType: upload.media_type, durationSeconds }
    })
    const paths = uploads.map((upload) => upload.path)
    if (new Set(paths).size !== paths.length) throw new ApiError(400, 'Duplicate catalogue media paths are not allowed.')

    const { data: currentMedia, error: mediaError } = await client.from('member_photos')
      .select('media_type')
      .eq('member_id', memberId)
    if (mediaError) throw new ApiError(502, mediaError.message)
    const imageCount = uploads.filter((upload) => upload.mediaType === 'image').length
    const videoCount = uploads.filter((upload) => upload.mediaType === 'video').length
    const existingImages = (currentMedia ?? []).filter((item) => item.media_type === 'image').length
    const existingVideos = (currentMedia ?? []).filter((item) => item.media_type === 'video').length
    if (existingImages + imageCount > maxCatalogueImages) throw new ApiError(409, 'A member can have up to 10 catalogue photos.')
    if (existingVideos + videoCount > maxCatalogueVideos || videoCount > maxCatalogueVideos) {
      throw new ApiError(409, 'A member can have only one catalogue video.')
    }
    const { data: lastPhoto, error: queryError } = await client.from('member_photos')
      .select('sort_order')
      .eq('member_id', memberId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (queryError) throw new ApiError(502, queryError.message)
    const sortOrder = (lastPhoto?.sort_order ?? -1) + 1
    const bucket = client.storage.from('member-photos')
    const rows = uploads.map((upload, index) => ({
      member_id: memberId,
      image_url: bucket.getPublicUrl(upload.path).data.publicUrl,
      storage_path: upload.path,
      caption: null,
      sort_order: sortOrder + index,
      media_type: upload.mediaType,
      duration_seconds: upload.durationSeconds,
    }))
    const { data, error } = await client.from('member_photos').insert(rows).select('id')
    if (error) {
      const { error: cleanupError } = await bucket.remove(paths)
      if (cleanupError) console.error('Unable to remove uploaded catalogue media after a failed insert.', cleanupError)
      throw new ApiError(502, error.message)
    }
    sendJson(response, 201, { uploaded: data.length })
    return
  }

  sendJson(response, 404, { error: 'Admin endpoint not found.' })
}

export async function handleAdminApi(request, response, url) {
  if (!url.pathname.startsWith('/api/admin/')) return false

  try {
    if (request.method !== 'GET') requireSameOrigin(request)
    await handleAdminRequest(request, response, url)
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    if (status >= 500) console.error('Admin API request failed.', error)
    sendJson(response, status, {
      error: status === 500 ? 'Admin request failed. Please try again.' : error.message,
    })
  }
  return true
}
