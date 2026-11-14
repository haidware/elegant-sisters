import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type TouchEvent } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ImagePlus,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Play,
  Printer,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import './App.css'

type Group = {
  id: string
  slug: string
  name: string
  description: string | null
  member_count: number
  sort_order: number
  published: boolean
}

type Member = {
  id: string
  group_id: string
  slug: string
  full_name: string
  role_title: string
  bio: string | null
  portrait_url: string | null
  portrait_storage_path: string | null
  media_ready: boolean
  sort_order: number
  published: boolean
}

type MemberPhoto = {
  id: string
  member_id: string
  image_url: string
  storage_path: string
  caption: string | null
  sort_order: number
  created_at: string
  media_type: 'image' | 'video'
  duration_seconds: number | null
}

type MemberWithPhotos = Member & { photos: MemberPhoto[]; group: Group }
type UploadableMedia = { file: File; mediaType: 'image' | 'video' }
type MediaUploadResult = { uploaded: File[]; failed: File[]; errors: string[] }
const elegantSistersGroupSlug = 'new-era-elegant-sisters-international'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function slugify(value: string) {
  return value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function getVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => resolve(video.duration)
      video.onerror = () => reject(new Error(`${file.name}: unable to read video duration.`))
      video.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  const payload = await response.json().catch(() => null) as { error?: string } | T | null
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'Admin request failed. Please try again.'
    throw new Error(message)
  }
  if (payload === null) throw new Error('The admin server returned an invalid response.')
  return payload as T
}

function App() {
  return (
    <BrowserRouter>
      <div className="site-shell">
        <SiteHeader />
        <Routes>
          <Route path="/" element={<AdminPage />} />
          <Route path="/groups" element={<GroupDirectoryPage />} />
          <Route path="/admin" element={<Navigate replace to="/" />} />
          <Route path="/:groupSlug/:memberSlug" element={<MemberPage />} />
          <Route path="/:groupSlug" element={<GroupPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <SiteFooter />
      </div>
    </BrowserRouter>
  )
}

function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="site-header">
      <Link aria-label="Membergram groups" className="brand-lockup" to="/groups">
        <span className="brand-mark"><Leaf size={19} strokeWidth={1.6} /></span>
        <span className="brand-name">Membergram<span>Stories &amp; community</span></span>
      </Link>
      <button
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        className="mobile-menu-button"
        onClick={() => setMenuOpen(!menuOpen)}
        type="button"
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav aria-label="Main navigation" className={menuOpen ? 'main-nav is-open' : 'main-nav'}>
        <Link onClick={() => setMenuOpen(false)} to="/groups">Our groups</Link>
        <a href="/groups#about" onClick={() => setMenuOpen(false)}>Our story</a>
        <Link className="nav-admin" onClick={() => setMenuOpen(false)} to="/">
          <LockKeyhole size={15} /> Admin
        </Link>
      </nav>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link aria-label="Membergram groups" className="footer-mark" to="/groups"><Leaf size={15} /></Link>
      <p>Growing together, one story at a time.</p>
      <span>Membergram · Communities and connections</span>
    </footer>
  )
}

function ConnectionNotice() {
  return (
    <div className="connection-notice" role="status">
      <CircleHelp size={18} />
      <div>
        <strong>One last connection step</strong>
        <p>Add your Supabase anon key to <code>.env.local</code> to connect member profiles and photo storage.</p>
      </div>
    </div>
  )
}

function GroupDirectoryPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadGroups() {
      if (!supabase) {
        setLoading(false)
        return
      }
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('id, slug, name, description, member_count, sort_order, published')
        .eq('published', true)
        .order('sort_order', { ascending: true })
      if (!active) return
      if (groupError) {
        setError(groupError.message)
      } else {
        const publishedGroups = groupData ?? []
        setGroups(publishedGroups)
        if (publishedGroups.length) {
          const { data: memberData, error: memberError } = await supabase
            .from('members')
            .select('group_id')
            .in('group_id', publishedGroups.map((group) => group.id))
            .eq('published', true)
          if (memberError) setError(memberError.message)
          else {
            const counts: Record<string, number> = {}
            for (const member of memberData ?? []) counts[member.group_id] = (counts[member.group_id] ?? 0) + 1
            setMemberCounts(counts)
          }
        }
      }
      setLoading(false)
    }
    void loadGroups()
    return () => { active = false }
  }, [])

  return (
    <main>
      <section className="directory-hero">
        <div className="eyebrow"><span /> A LIVING RECORD OF BELONGING <span /></div>
        <h1>Find your <em>community.</em></h1>
        <p>Choose a group to explore the people, stories and connections that make it special.</p>
        <div className="directory-flourish"><Leaf size={18} /><span /><Leaf size={18} /></div>
      </section>
      <section className="group-directory" id="groups">
        <div className="directory-heading">
          <div><div className="eyebrow eyebrow-dark">OUR COMMUNITIES</div><h2>One place, <em>many groups.</em></h2></div>
          <span className="member-count">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
        </div>
        {!supabase && <ConnectionNotice />}
        {error && <div className="inline-error" role="alert">{error}</div>}
        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" size={22} /> Finding our communities…</div>
        ) : groups.length ? (
          <div className="group-grid">
            {groups.map((group) => <GroupCard group={group} key={group.id} memberCount={memberCounts[group.id] ?? 0} />)}
          </div>
        ) : (
          <div className="empty-tree">
            <div className="empty-icon"><Leaf size={29} /></div>
            <h3>{supabase ? 'Your first group is ready to grow.' : 'Bring your community together.'}</h3>
            <p>{supabase ? 'Sign in to create a group and start its member directory.' : 'Connect Supabase to open group pages and member catalogues.'}</p>
            <Link className="button button-gold" to="/"><LockKeyhole size={16} /> Open the admin area</Link>
          </div>
        )}
      </section>
      <section className="about-strip" id="about">
        <div className="about-icon"><Sparkles size={21} /></div>
        <div><div className="eyebrow eyebrow-dark">ONE PLATFORM, MANY COMMUNITIES</div><h2>Every member <em>belongs.</em></h2></div>
        <p>Choose a group to meet its members, browse their photo catalogues, and explore its tree.</p>
      </section>
    </main>
  )
}

function GroupCard({ group, memberCount }: { group: Group; memberCount: number }) {
  return (
    <Link className="group-card" to={`/${group.slug}`}>
      <div className="group-card-art">
        <span className="group-card-seal"><Leaf size={29} /><small>BUILT ON<br />CONNECTION</small></span>
        <span className="group-card-leaf leaf-one"><Leaf size={24} /></span>
        <span className="group-card-leaf leaf-two"><Leaf size={19} /></span>
        <span className="group-card-leaf leaf-three"><Leaf size={15} /></span>
      </div>
      <div className="group-card-copy">
        <div className="group-card-meta"><span><span className="status-dot" /> COMMUNITY</span><span>{memberCount} {memberCount === 1 ? 'member' : 'members'}</span></div>
        <h3>{group.name}</h3>
        <p>{group.description || 'A community of purpose, connection and shared legacy.'}</p>
        <span className="group-card-link">Explore this group <ArrowUpRight size={16} /></span>
      </div>
    </Link>
  )
}

function GroupPage() {
  const { groupSlug = '' } = useParams()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [legacyPhotos, setLegacyPhotos] = useState<Record<string, string>>({})
  const [loadedSlug, setLoadedSlug] = useState('')
  const [error, setError] = useState('')
  const [errorSlug, setErrorSlug] = useState('')
  const [search, setSearch] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [cataloguePhotos, setCataloguePhotos] = useState<MemberPhoto[]>([])
  const [catalogueLoadingId, setCatalogueLoadingId] = useState('')
  const [catalogueError, setCatalogueError] = useState('')
  const loading = loadedSlug !== groupSlug
  const selectedMember = loading ? null : members.find((member) => member.id === selectedMemberId) ?? null

  useEffect(() => {
    let active = true
    async function loadGroup() {
      if (!supabase) return
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('id, slug, name, description, member_count, sort_order, published')
        .eq('slug', groupSlug)
        .eq('published', true)
        .maybeSingle()
      if (!active) return
      if (groupError) {
        setError(groupError.message)
        setErrorSlug(groupSlug)
        setLoadedSlug(groupSlug)
        return
      }
      if (!groupData) {
        setGroup(null)
        setMembers([])
        setLegacyPhotos({})
        setLoadedSlug(groupSlug)
        return
      }
      setGroup(groupData)
      const { data, error: queryError } = await supabase
        .from('members')
        .select('id, group_id, slug, full_name, role_title, bio, portrait_url, portrait_storage_path, media_ready, sort_order, published')
        .eq('group_id', groupData.id)
        .eq('published', true)
        .order('sort_order', { ascending: true })
      if (!active) return
      if (queryError) {
        setError(queryError.message)
        setErrorSlug(groupSlug)
      } else {
        const publishedMembers = data ?? []
        setMembers(publishedMembers)
        setLegacyPhotos({})
        if (publishedMembers.length) {
          const { data: photoData, error: photoError } = await supabase
            .from('member_photos')
            .select('member_id, image_url, media_type')
            .in('member_id', publishedMembers.map((member) => member.id))
            .eq('media_type', 'image')
            .order('sort_order', { ascending: true })
          if (active && photoError) {
            setError(photoError.message)
            setErrorSlug(groupSlug)
          } else if (active) {
            const firstPhotos: Record<string, string> = {}
            for (const photo of photoData ?? []) {
              if (!firstPhotos[photo.member_id]) firstPhotos[photo.member_id] = photo.image_url
            }
            setLegacyPhotos(firstPhotos)
          }
        } else if (active) setLegacyPhotos({})
      }
      if (active) setLoadedSlug(groupSlug)
    }
    void loadGroup()
    return () => { active = false }
  }, [groupSlug])

  useEffect(() => {
    if (!selectedMemberId || !supabase) return

    let active = true
    const client = supabase
    async function loadCatalogue() {
      try {
        const { data, error: photoError } = await client
          .from('member_photos')
          .select('id, member_id, image_url, storage_path, caption, sort_order, created_at, media_type, duration_seconds')
          .eq('member_id', selectedMemberId)
          .order('sort_order', { ascending: true })
        if (!active) return
        if (photoError) {
          setCatalogueError(photoError.message)
          setCataloguePhotos([])
        } else {
          setCataloguePhotos(data ?? [])
        }
      } catch (reason: unknown) {
        if (active) {
          setCataloguePhotos([])
          setCatalogueError(getErrorMessage(reason))
        }
      } finally {
        if (active) setCatalogueLoadingId((current) => current === selectedMemberId ? '' : current)
      }
    }
    void loadCatalogue()
    return () => { active = false }
  }, [selectedMemberId])

  function openCatalogue(memberId: string) {
    setSelectedMemberId(memberId)
    setCataloguePhotos([])
    setCatalogueError('')
    setCatalogueLoadingId(memberId)
  }

  const filteredMembers = members.filter((member) =>
    `${member.full_name} ${member.role_title}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  if (!supabase) return <main className="page-main"><ConnectionNotice /><Link className="back-link" to="/"><ArrowLeft size={15} /> Back to groups</Link></main>
  if (loading) return <main className="page-main loading-state"><LoaderCircle className="spin" size={22} /> Opening this group…</main>
  if (error && errorSlug === groupSlug) return <main className="page-main"><div className="inline-error" role="alert">{error}</div></main>
  if (!group) return <NotFoundPage />

  return (
    <main>
      <section className={group.slug === elegantSistersGroupSlug ? 'group-hero is-elegant-sisters' : 'group-hero'}>
        <div className="hero-copy">
          <div className="eyebrow"><span /> A LIVING RECORD OF BELONGING</div>
          <h1>Every member.<br /><em>One shared legacy.</em></h1>
          <p>Explore the people, stories and connections that make {group.name} special. Browse member profiles, photo catalogues, and the group tree.</p>
          <div className="group-hero-actions">
            <a className="button button-gold" href="#members">Explore members <ArrowUpRight size={16} /></a>
            <button className="button button-white" disabled={!members.length} onClick={() => setExportOpen(true)} type="button"><Download size={15} /> Download group tree</button>
          </div>
          <div className="group-stats">
            <div><strong>{members.length}</strong><span>Listed members</span></div>
            <div><strong>01</strong><span>Shared community</span></div>
            <div><strong>∞</strong><span>Stories to preserve</span></div>
          </div>
        </div>
        <GroupPosterPreview group={group} members={members} photos={legacyPhotos} onSelectMember={openCatalogue} />
      </section>

      <section className="members-section" id="members">
        <div className="section-heading">
          <div>
            <div className="eyebrow eyebrow-dark"><span /> {group.name.toUpperCase()} MEMBER TREE</div>
            <h2>Meet the <em>members.</em></h2>
            <p>Discover the people who make this community what it is.</p>
          </div>
          <div className="tree-actions">
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search members"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a member"
                value={search}
              />
            </label>
            <button
              className="button button-outline"
              disabled={!members.length}
              onClick={() => setExportOpen(true)}
              type="button"
            >
              <QrCode size={16} /> Share the tree
            </button>
          </div>
        </div>

        {!supabase && <ConnectionNotice />}
        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" size={22} /> Growing this member tree…</div>
        ) : filteredMembers.length || (!search.trim() && group.member_count > 0) ? (
          <div className={group.slug === elegantSistersGroupSlug ? 'tree-wrap is-elegant-sisters' : 'tree-wrap'}>
            <div className="tree-canopy" aria-hidden="true" />
            <div className="member-tree">
              {buildMemberTreeTiers(filteredMembers, group.member_count).map((tier, tierIndex) => (
                <div className="member-tree-tier" key={tierIndex}>
                  {tier.centerLabel && (
                    <div className="tree-group-sign" style={{ gridColumn: '3 / 6' }}>
                      <Sparkles size={16} />
                      <strong>{group.name}</strong>
                    </div>
                  )}
                  {tier.members.map(({ member, rank }, index) => member ? (
                    <MemberTreeCard
                      key={member.id}
                      member={member}
                      number={rank}
                      onSelectMember={openCatalogue}
                      photo={member.portrait_url || legacyPhotos[member.id] || ''}
                      style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }}
                    />
                  ) : (
                    <TreeMemberPlaceholder key={`slot-${rank}`} rank={rank} style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="tree-roots"><span /><Leaf size={19} /><span /></div>
          </div>
        ) : (
          <div className="empty-tree">
            <div className="empty-icon"><Leaf size={29} /></div>
            <h3>{members.length ? 'No members found' : 'A new tree is taking root.'}</h3>
            <p>{members.length ? 'Try another name or role.' : `${group.name} is ready to grow. Add the first member and their photos from the admin area.`}</p>
            {!members.length && <Link className="button button-gold" to="/"><LockKeyhole size={16} /> Open the admin area</Link>}
          </div>
        )}
      </section>

      <section className="about-strip" id="about">
        <div className="about-icon"><Sparkles size={21} /></div>
        <div>
          <div className="eyebrow eyebrow-dark">ONE COMMUNITY, MANY STORIES</div>
          <h2>Celebrating every <em>member.</em></h2>
        </div>
        <p>Select any member to open their swipeable photo and video catalogue.</p>
      </section>

      {selectedMember && (
        <MemberCatalogueDialog
          catalogueError={catalogueError}
          group={group}
          loading={catalogueLoadingId === selectedMemberId}
          member={selectedMember}
          onClose={() => setSelectedMemberId('')}
          photos={cataloguePhotos}
        />
      )}
      {exportOpen && <TreeExport group={group} members={members} photos={legacyPhotos} onClose={() => setExportOpen(false)} />}
    </main>
  )
}

function GroupPosterPreview({ group, members, photos, onSelectMember }: { group: Group; members: Member[]; photos: Record<string, string>; onSelectMember: (memberId: string) => void }) {
  const tiers = buildMemberTreeTiers(members, group.member_count)
  return (
    <div aria-label={`${group.name} member tree preview`} className={group.slug === elegantSistersGroupSlug ? 'group-poster-wrap is-elegant-sisters' : 'group-poster-wrap'}>
      <div className={group.slug === elegantSistersGroupSlug ? 'group-poster is-elegant-sisters' : 'group-poster'}>
        <div className={group.slug === elegantSistersGroupSlug ? 'group-poster-border is-elegant-sisters' : 'group-poster-border'}>
          <div className="group-poster-heading"><span>✦ &nbsp; ✦ &nbsp; ✦</span><small>{group.name.toUpperCase()}</small><b>MEMBER TREE</b></div>
          {members.length || group.member_count > 0 ? (
            <div className="group-poster-members">
              {tiers.map((tier, tierIndex) => (
                <div className="group-poster-tier" key={tierIndex}>
                  {tier.centerLabel && <div className="group-poster-center" style={{ gridColumn: '3 / 6' }}>{group.name}</div>}
                  {tier.members.map(({ member, rank }, index) => member ? (
                    <button
                      aria-label={`View ${member.full_name}'s catalogue`}
                      aria-haspopup="dialog"
                      className="group-poster-member"
                      key={member.id}
                      onClick={() => onSelectMember(member.id)}
                      style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }}
                      type="button"
                    >
                      <span className="group-poster-avatar">
                        {member.portrait_url || photos[member.id] ? <img alt="" crossOrigin="anonymous" src={member.portrait_url || photos[member.id]} /> : <Camera size={17} />}
                        <i>{rank}</i>
                      </span>
                      <strong>{member.full_name}</strong>
                      <small>{member.role_title || 'Member'}</small>
                    </button>
                  ) : (
                    <div aria-label={`Available member position ${rank}`} className="group-poster-member is-empty" key={`slot-${rank}`} style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }}>
                      <span className="group-poster-avatar"><Camera size={17} /><i>{rank}</i></span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="group-poster-empty"><span><Leaf size={28} /></span><b>Your members will grow here.</b><small>Add the first member in the admin studio.</small></div>
          )}
          <div className="group-poster-footer"><span />ROOTED IN COMMUNITY · GROWING TOGETHER<span /></div>
        </div>
      </div>
      <span className="poster-caption"><QrCode size={13} /> A living member tree · {members.length} {members.length === 1 ? 'member' : 'members'}</span>
    </div>
  )
}

type MemberTreeSlot = { member: Member | null; rank: number }
type MemberTreeTier = { members: MemberTreeSlot[]; centerLabel: boolean }

function buildMemberTreeTiers(members: Member[], plannedMemberCount = members.length): MemberTreeTier[] {
  const tiers: MemberTreeTier[] = []
  const membersByRank = new Map(members.map((member) => [member.sort_order + 1, member]))
  const highestRank = Math.max(0, ...membersByRank.keys())
  const memberCount = Math.max(plannedMemberCount, highestRank)
  const slots = Array.from({ length: memberCount }, (_, index) => ({
    member: membersByRank.get(index + 1) ?? null,
    rank: index + 1,
  }))
  let offset = 0
  for (const size of [1, 2, 5, 6]) {
    if (offset >= slots.length) break
    const tierMembers = slots.slice(offset, offset + size)
    tiers.push({ members: tierMembers, centerLabel: false })
    offset += tierMembers.length
  }
  if (offset < slots.length) {
    const centerMembers = slots.slice(offset, offset + 4)
    tiers.push({ members: centerMembers, centerLabel: true })
    offset += centerMembers.length
  }
  while (offset < slots.length) {
    const tierMembers = slots.slice(offset, offset + 7)
    tiers.push({ members: tierMembers, centerLabel: false })
    offset += tierMembers.length
  }
  return tiers
}

function getTreeTierColumn(index: number, memberCount: number, centerLabel: boolean) {
  if (centerLabel) return index < 2 ? index + 1 : index + 4
  const columnsByCount: Record<number, number[]> = {
    1: [4],
    2: [3, 5],
    3: [3, 4, 5],
    4: [2, 3, 5, 6],
    5: [2, 3, 4, 5, 6],
    6: [1, 2, 3, 5, 6, 7],
    7: [1, 2, 3, 4, 5, 6, 7],
  }
  return columnsByCount[memberCount]?.[index] ?? index + 1
}

function MemberTreeCard({ member, number, photo, onSelectMember, style }: { member: Member; number: number; photo: string; onSelectMember: (memberId: string) => void; style?: CSSProperties }) {
  const [photoError, setPhotoError] = useState(false)

  return (
    <button aria-haspopup="dialog" aria-label={`Open ${member.full_name}'s catalogue`} className="member-card" onClick={() => onSelectMember(member.id)} style={style} type="button">
      <span aria-hidden="true" className="fruit-vine"><i /><i /></span>
      <span className="member-number">{number}</span>
      <span className="portrait-frame">
        {photo && !photoError ? (
          <img alt="" crossOrigin="anonymous" onError={() => setPhotoError(true)} src={photo} />
        ) : (
          <span className="portrait-placeholder"><Camera size={24} strokeWidth={1.3} /></span>
        )}
      </span>
      <span className="member-name">{member.full_name}</span>
      <span className="member-role">{member.role_title || 'Member'}</span>
    </button>
  )
}

function MemberCatalogueDialog({ catalogueError, group, loading, member, onClose, photos }: {
  catalogueError: string
  group: Group
  loading: boolean
  member: Member
  onClose: () => void
  photos: MemberPhoto[]
}) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [activePhoto, setActivePhoto] = useState<MemberPhoto | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (activePhoto) setActivePhoto(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePhoto, onClose])

  function movePhoto(direction: number) {
    const currentIndex = photos.findIndex((photo) => photo.id === activePhoto?.id)
    if (currentIndex < 0 || !photos.length) return
    setActivePhoto(photos[(currentIndex + direction + photos.length) % photos.length])
  }

  function scrollGallery(direction: number) {
    const gallery = galleryRef.current
    if (gallery) gallery.scrollBy({ left: direction * Math.max(gallery.clientWidth * 0.8, 280), behavior: 'smooth' })
  }

  return (
    <div className="catalogue-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !activePhoto) onClose() }} role="presentation">
      <section aria-labelledby="catalogue-title" aria-modal="true" className="catalogue-modal" role="dialog">
        <header className="catalogue-modal-header">
          <div className="catalogue-member-summary">
            <div className="catalogue-member-avatar">
              {member.portrait_url || photos.find((photo) => photo.media_type === 'image')?.image_url
                ? <img alt="" crossOrigin="anonymous" src={member.portrait_url || photos.find((photo) => photo.media_type === 'image')?.image_url} />
                : <Camera size={24} />}
            </div>
            <div>
              <div className="eyebrow eyebrow-dark">{group.name}</div>
              <h2 id="catalogue-title">{member.full_name}</h2>
              <p>{member.role_title || 'Member'}{member.bio ? ` · ${member.bio}` : ''}</p>
            </div>
          </div>
          <button aria-label="Close member catalogue" className="icon-button" onClick={onClose} ref={closeButtonRef} type="button"><X size={20} /></button>
        </header>
        <div className="catalogue-modal-content">
          <div className="catalogue-modal-toolbar">
            <div><div className="eyebrow eyebrow-dark">MEMBER CATALOGUE</div><h3>Photos &amp; <em>videos</em></h3></div>
            {!!photos.length && <div className="catalogue-carousel-controls">
              <button aria-label="Scroll catalogue left" className="icon-button" disabled={loading} onClick={() => scrollGallery(-1)} type="button"><ChevronLeft size={18} /></button>
              <button aria-label="Scroll catalogue right" className="icon-button" disabled={loading} onClick={() => scrollGallery(1)} type="button"><ChevronRight size={18} /></button>
            </div>}
          </div>
          {catalogueError && <div className="inline-error" role="alert">Could not load this catalogue: {catalogueError}</div>}
          {loading ? (
            <div className="catalogue-loading"><LoaderCircle className="spin" size={20} /> Loading catalogue…</div>
          ) : photos.length ? (
            <div aria-label={`${member.full_name}'s swipeable photo and video catalogue`} className="photo-gallery catalogue-modal-gallery" ref={galleryRef} role="region" tabIndex={0}>
              {photos.map((photo) => (
                <button aria-label={`Expand ${photo.media_type === 'video' ? 'video' : 'photo'}${photo.caption ? `: ${photo.caption}` : ''}`} className="catalogue-photo" key={photo.id} onClick={() => setActivePhoto(photo)} type="button">
                  {photo.media_type === 'video'
                    ? <><video aria-label={`Video of ${member.full_name}`} preload="metadata" src={photo.image_url} /><span className="catalogue-play"><Play size={20} fill="currentColor" /></span></>
                    : <img alt={photo.caption || `Photo of ${member.full_name}`} crossOrigin="anonymous" loading="lazy" src={photo.image_url} />}
                  {photo.caption && <span>{photo.caption}</span>}
                </button>
              ))}
            </div>
          ) : catalogueError ? null : (
            <div className="gallery-empty"><ImagePlus size={23} /><p>No catalogue media has been added yet.</p></div>
          )}
        </div>
        {activePhoto && (
          <PhotoLightbox
            onClose={() => setActivePhoto(null)}
            onNext={() => movePhoto(1)}
            onPrevious={() => movePhoto(-1)}
            photo={activePhoto}
            position={photos.findIndex((photo) => photo.id === activePhoto.id) + 1}
            total={photos.length}
          />
        )}
      </section>
    </div>
  )
}

function TreeMemberPlaceholder({ rank, style }: { rank: number; style?: CSSProperties }) {
  return (
    <div aria-label={`Available member position ${rank}`} className="member-card is-empty" style={style}>
      <span aria-hidden="true" className="fruit-vine"><i /><i /></span>
      <span className="member-number">{rank}</span>
      <span className="portrait-frame"><span className="portrait-placeholder"><Camera size={24} strokeWidth={1.3} /></span></span>
      <span className="member-name-placeholder" />
      <span className="member-role-placeholder" />
    </div>
  )
}

function MemberPage() {
  const { groupSlug = '', memberSlug = '' } = useParams()
  const [member, setMember] = useState<MemberWithPhotos | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState('')
  const [activePhoto, setActivePhoto] = useState<MemberPhoto | null>(null)
  const pageKey = `${groupSlug}/${memberSlug}`
  const loading = loadedKey !== pageKey

  function movePhoto(direction: -1 | 1) {
    if (!member || !activePhoto) return
    const currentIndex = member.photos.findIndex((photo) => photo.id === activePhoto.id)
    if (currentIndex < 0 || !member.photos.length) return
    const nextIndex = (currentIndex + direction + member.photos.length) % member.photos.length
    setActivePhoto(member.photos[nextIndex])
  }

  useEffect(() => {
    let active = true
    async function loadMember() {
      if (!supabase) return
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('id, slug, name, description, member_count, sort_order, published')
        .eq('slug', groupSlug)
        .eq('published', true)
        .maybeSingle()
      if (!active) return
      if (groupError) {
        setError(groupError.message)
        setErrorKey(pageKey)
        setLoadedKey(pageKey)
        return
      }
      if (!groupData) {
        setMember(null)
        setLoadedKey(pageKey)
        return
      }
      const { data: memberData, error: memberError } = await supabase
        .from('members')
        .select('id, group_id, slug, full_name, role_title, bio, portrait_url, portrait_storage_path, media_ready, sort_order, published')
        .eq('group_id', groupData.id)
        .eq('slug', memberSlug)
        .eq('published', true)
        .maybeSingle()
      if (!active) return
      if (memberError) {
        setError(memberError.message)
        setErrorKey(pageKey)
      } else if (memberData) {
        const { data: photos, error: photoError } = await supabase
          .from('member_photos')
          .select('id, member_id, image_url, storage_path, caption, sort_order, created_at, media_type, duration_seconds')
          .eq('member_id', memberData.id)
          .order('sort_order', { ascending: true })
        if (active) {
          if (photoError) {
            setError(photoError.message)
            setErrorKey(pageKey)
          }
          else setMember({ ...memberData, group: groupData, photos: photos ?? [] })
        }
      } else {
        setMember(null)
      }
      if (active) setLoadedKey(pageKey)
    }
    void loadMember()
    return () => { active = false }
  }, [groupSlug, memberSlug, pageKey])

  if (!supabase) return <main className="page-main"><ConnectionNotice /><Link className="back-link" to="/"><ArrowLeft size={15} /> Back to groups</Link></main>
  if (loading) return <main className="page-main loading-state"><LoaderCircle className="spin" size={22} /> Opening their story…</main>
  if (error && errorKey === pageKey) return <main className="page-main"><div className="inline-error" role="alert">{error}</div></main>
  if (!member) return <NotFoundPage />

  return (
    <main className="profile-page">
      <div className="profile-back"><Link className="back-link" to={`/${member.group.slug}`}><ArrowLeft size={15} /> Back to {member.group.name}</Link></div>
      <section className="profile-intro">
        <span className="profile-kicker"><span /> A MEMBER'S STORY <span /></span>
        <div className="profile-avatar">
          {member.portrait_url || member.photos.find((photo) => photo.media_type === 'image')?.image_url
            ? <img alt="" crossOrigin="anonymous" src={member.portrait_url || member.photos.find((photo) => photo.media_type === 'image')?.image_url} />
            : <Camera size={32} />}
        </div>
        <h1>{member.full_name}</h1>
        <p className="profile-role">{member.role_title || 'Member'}</p>
        {member.bio && <p className="profile-bio">{member.bio}</p>}
        <div className="profile-meta"><span><Camera size={14} /> {member.photos.filter((photo) => photo.media_type === 'image').length} {member.photos.filter((photo) => photo.media_type === 'image').length === 1 ? 'photo' : 'photos'}{member.photos.some((photo) => photo.media_type === 'video') ? ' and 1 video' : ''} in their catalogue</span></div>
      </section>

      <section className="catalogue-section">
        <div className="catalogue-heading">
          <div><div className="eyebrow eyebrow-dark">MEMBER CATALOGUE</div><h2>A catalogue of <em>memories.</em></h2></div>
        </div>
        {member.photos.length ? (
          <div aria-label={`${member.full_name}'s photo and video catalogue`} className="photo-gallery" role="region" tabIndex={0}>
            {member.photos.map((photo) => (
              <button className="catalogue-photo" key={photo.id} onClick={() => setActivePhoto(photo)} type="button">
                {photo.media_type === 'video'
                  ? <><video aria-label={`Video of ${member.full_name}`} preload="metadata" src={photo.image_url} /><span className="catalogue-play"><Play size={20} fill="currentColor" /></span></>
                  : <img alt={photo.caption || `Photo of ${member.full_name}`} crossOrigin="anonymous" loading="lazy" src={photo.image_url} />}
                {photo.caption && <span>{photo.caption}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="gallery-empty"><ImagePlus size={23} /><p>Their photo catalogue is ready for its first memory.</p></div>
        )}
      </section>
      <ShareMember member={member} />
      {activePhoto && (
        <PhotoLightbox
          onClose={() => setActivePhoto(null)}
          onNext={() => movePhoto(1)}
          onPrevious={() => movePhoto(-1)}
          photo={activePhoto}
          position={member.photos.findIndex((photo) => photo.id === activePhoto.id) + 1}
          total={member.photos.length}
        />
      )}
    </main>
  )
}

function ShareMember({ member }: { member: MemberWithPhotos }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const shareUrl = `${window.location.origin}/${member.group.slug}/${member.slug}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setCopyError('')
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      setCopyError(getErrorMessage(error))
    }
  }

  return (
    <section className="profile-share">
      <div className="share-qr"><QRCodeGraphic url={shareUrl} size={112} /></div>
      <div><div className="eyebrow eyebrow-dark">PASS THEIR STORY ALONG</div><h2>Share their <em>catalogue.</em></h2><p>Scan their QR code or copy their personal link.</p></div>
      <button className="button button-outline" onClick={() => void copyLink()} type="button">{copied ? <Check size={16} /> : <ArrowUpRight size={16} />}{copied ? 'Copied' : 'Copy profile link'}</button>
      {copyError && <p className="copy-error" role="alert">{copyError}</p>}
    </section>
  )
}

function QRCodeGraphic({ url, size }: { url: string; size: number }) {
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    QRCode.toDataURL(url, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#173c2c', light: '#ffffff' } })
      .then((result) => { if (active) setDataUrl(result) })
      .catch((reason: unknown) => { if (active) setError(getErrorMessage(reason)) })
    return () => { active = false }
  }, [size, url])

  if (error) return <span className="qr-error" title={error}>QR unavailable</span>
  if (!dataUrl) return <span className="qr-loading"><LoaderCircle className="spin" size={17} /></span>
  return <img alt={`QR code for ${url}`} height={size} src={dataUrl} width={size} />
}

function PhotoLightbox({
  photo,
  onClose,
  onNext,
  onPrevious,
  position,
  total,
}: {
  photo: MemberPhoto
  onClose: () => void
  onNext: () => void
  onPrevious: () => void
  position: number
  total: number
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrevious()
      if (event.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onNext, onPrevious])

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    touchStart.current = null
    if (!start || !touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return
    if (deltaX < 0) onNext()
    else onPrevious()
  }

  return (
    <div className="lightbox" onClick={onClose} onTouchEnd={handleTouchEnd} onTouchStart={handleTouchStart} role="presentation">
      <button aria-label="Close photo" className="lightbox-close" onClick={onClose} type="button"><X size={22} /></button>
      <button aria-label="Previous media" className="lightbox-nav lightbox-previous" onClick={(event) => { event.stopPropagation(); onPrevious() }} type="button"><ChevronLeft size={25} /></button>
      <button aria-label="Next media" className="lightbox-nav lightbox-next" onClick={(event) => { event.stopPropagation(); onNext() }} type="button"><ChevronRight size={25} /></button>
      {photo.media_type === 'video'
        ? <video autoPlay controls playsInline onClick={(event) => event.stopPropagation()} src={photo.image_url} />
        : <img alt={photo.caption || 'Member catalogue photo'} crossOrigin="anonymous" onClick={(event) => event.stopPropagation()} src={photo.image_url} />}
      {photo.caption && <p>{photo.caption}</p>}
      <span className="lightbox-position">{position} / {total}</span>
    </div>
  )
}

function TreeExport({ group, members, photos, onClose }: { group: Group; members: Member[]; photos: Record<string, string>; onClose: () => void }) {
  const posterRef = useRef<HTMLDivElement>(null)
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadQRCodes() {
      const qrEntries = await Promise.all(members.map(async (member) => [
        member.id,
        await QRCode.toDataURL(`${window.location.origin}/${group.slug}/${member.slug}`, {
          width: 110,
          margin: 0,
          errorCorrectionLevel: 'M',
          color: { dark: '#173c2c', light: '#ffffff' },
        }),
      ] as const))
      if (active) {
        setQrCodes(Object.fromEntries(qrEntries))
      }
    }
    void loadQRCodes().catch((reason: unknown) => { if (active) setError(getErrorMessage(reason)) })
    return () => { active = false }
  }, [group.slug, members])

  async function exportImage(kind: 'png' | 'pdf') {
    if (!posterRef.current) return
    setWorking(true)
    setError('')
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      await Promise.all(Array.from(posterRef.current.querySelectorAll('img')).map((image) => {
        if (image.complete) {
          return image.naturalWidth > 0
            ? Promise.resolve()
            : Promise.reject(new Error('A poster image could not be loaded. Check that the image is publicly accessible in Supabase Storage.'))
        }
        return new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => reject(new Error('A poster image could not be loaded. Check that the image is publicly accessible in Supabase Storage.')), { once: true })
        })
      }))
      const canvas = await html2canvas(posterRef.current, { backgroundColor: '#fffaf0', scale: 2, useCORS: true, logging: false })
      const fileName = `${group.slug}-group-tree`
      if (kind === 'png') {
        const anchor = document.createElement('a')
        anchor.download = `${fileName}.png`
        anchor.href = canvas.toDataURL('image/png')
        anchor.click()
      } else {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
        const width = canvas.width * scale
        const height = canvas.height * scale
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height)
        pdf.save(`${fileName}.pdf`)
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape' && !working) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, working])

  const ready = members.length > 0 && Object.keys(qrCodes).length === members.length

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose() }} role="presentation">
      <section aria-labelledby="export-title" aria-modal="true" className="export-modal" role="dialog">
        <div className="modal-heading">
          <div><div className="eyebrow eyebrow-dark">SHARE YOUR GROUP</div><h2 id="export-title">The member tree, <em>to go.</em></h2><p>Each member's portrait and QR code links to their photo catalogue.</p></div>
          <button aria-label="Close export" className="icon-button" disabled={working} onClick={onClose} type="button"><X size={20} /></button>
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="poster-preview-scroll">
          <div className={group.slug === elegantSistersGroupSlug ? 'tree-poster is-elegant-sisters' : 'tree-poster'} ref={posterRef}>
            <div className="poster-title">
              <span className="poster-flourish">✦ &nbsp; ✦ &nbsp; ✦</span>
              <p>{group.name}</p>
              <h3>MEMBER<br />TREE</h3>
              <span className="poster-rule" />
              <small>ROOTED IN COMMUNITY · GROWING TOGETHER</small>
            </div>
            <div className="poster-members">
              {buildMemberTreeTiers(members, group.member_count).map((tier, tierIndex) => (
                <div className="poster-tier" key={tierIndex}>
                  {tier.centerLabel && <div className="poster-group-sign" style={{ gridColumn: '3 / 6' }}>{group.name}</div>}
                  {tier.members.map(({ member, rank }, index) => member ? (
                    <div className="poster-member" key={member.id} style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }}>
                      <div className="poster-portrait">
                        {member.portrait_url || photos[member.id] ? <img alt="" crossOrigin="anonymous" src={member.portrait_url || photos[member.id]} /> : <Camera size={20} />}
                        <span>{rank}</span>
                      </div>
                      <strong>{member.full_name}</strong>
                      <small>{member.role_title || 'Member'}</small>
                      {qrCodes[member.id] ? <img alt={`Scan to view ${member.full_name}'s catalogue`} className="poster-qr" src={qrCodes[member.id]} /> : <span className="poster-qr-placeholder" />}
                      <span className="poster-scan">SCAN THEIR STORY</span>
                    </div>
                  ) : (
                    <div aria-label={`Available member position ${rank}`} className="poster-member is-empty" key={`slot-${rank}`} style={{ gridColumn: getTreeTierColumn(index, tier.members.length, tier.centerLabel) }}>
                      <div className="poster-portrait"><Camera size={20} /><span>{rank}</span></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="poster-footer">A COMMUNITY OF STORIES &amp; CONNECTIONS</div>
          </div>
        </div>
        <div className="export-actions">
          <span><QrCode size={16} /> {members.length} personal QR {members.length === 1 ? 'code' : 'codes'}</span>
          <div>
            <button className="button button-outline" disabled={!ready || working} onClick={() => void exportImage('png')} type="button">
              {working ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Download image
            </button>
            <button className="button button-gold" disabled={!ready || working} onClick={() => void exportImage('pdf')} type="button">
              {working ? <LoaderCircle className="spin" size={16} /> : <Printer size={16} />} Save as PDF
            </button>
          </div>
        </div>
        {!ready && !error && <p className="export-hint"><LoaderCircle className="spin" size={14} /> Preparing portraits and QR codes…</p>}
      </section>
    </div>
  )
}

function AdminPage() {
  const [authLoading, setAuthLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    let active = true
    void adminRequest<{ authenticated: boolean }>('/session')
      .then(({ authenticated }) => {
        if (active) setIsAdmin(authenticated)
      })
      .catch((reason: unknown) => {
        if (active) setAuthError(getErrorMessage(reason))
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })
    return () => { active = false }
  }, [])

  async function signOut() {
    try {
      await adminRequest('/logout', { method: 'POST' })
      setIsAdmin(false)
      setAuthError('')
    } catch (reason) {
      setAuthError(getErrorMessage(reason))
    }
  }

  if (!supabase) {
    return <main className="admin-page"><div className="admin-frame"><div className="admin-heading"><div className="eyebrow eyebrow-dark">MEMBER MANAGEMENT</div><h1>Your admin <em>studio.</em></h1><p>Manage your members and their photo catalogues.</p></div><ConnectionNotice /></div></main>
  }
  if (authLoading) return <main className="page-main loading-state"><LoaderCircle className="spin" size={22} /> Checking your admin access…</main>
  if (!isAdmin) return <AdminLogin error={authError} onError={setAuthError} onSignedIn={() => { setIsAdmin(true); setAuthError('') }} />
  return <AdminDashboard onSignOut={() => void signOut()} />
}

function AdminLogin({ error, onError, onSignedIn }: { error: string; onError: (message: string) => void; onSignedIn: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWorking(true)
    onError('')
    try {
      await adminRequest('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      onSignedIn()
    } catch (reason) {
      onError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  return (
    <main className="admin-page">
      <div className="login-card">
        <div className="login-mark"><ShieldCheck size={22} /></div>
        <div className="eyebrow eyebrow-dark">PRIVATE MEMBER SPACE</div>
        <h1>Welcome <em>back.</em></h1>
        <p>Sign in to manage your groups and member catalogues.</p>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <form className="login-form" onSubmit={(event) => void signIn(event)}>
          <label>Superuser username<input autoComplete="username" onChange={(event) => setUsername(event.target.value)} required type="text" value={username} /></label>
          <label>Password<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          <button className="button button-gold button-full" disabled={working} type="submit">{working ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />} Sign in to admin</button>
        </form>
        <Link className="back-link login-back" to="/groups"><ArrowLeft size={15} /> Browse groups</Link>
      </div>
    </main>
  )
}

function AdminDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupMemberCount, setGroupMemberCount] = useState('')
  const [plannedMemberCount, setPlannedMemberCount] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [memberRank, setMemberRank] = useState('')
  const [bio, setBio] = useState('')
  const [treePortrait, setTreePortrait] = useState<File | null>(null)
  const [newMemberPhotos, setNewMemberPhotos] = useState<File[]>([])
  const [newMemberVideo, setNewMemberVideo] = useState<File | null>(null)
  const [pendingMemberId, setPendingMemberId] = useState('')
  const [catalogueMember, setCatalogueMember] = useState('')
  const [cataloguePortrait, setCataloguePortrait] = useState<File | null>(null)
  const [cataloguePhotos, setCataloguePhotos] = useState<File[]>([])
  const [catalogueVideo, setCatalogueVideo] = useState<File | null>(null)
  const [working, setWorking] = useState(false)
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null
  const usedTreeRanks = new Set(members.map((member) => member.sort_order + 1))
  let nextTreeRank = 1
  while (selectedGroup && nextTreeRank <= selectedGroup.member_count && usedTreeRanks.has(nextTreeRank)) {
    nextTreeRank += 1
  }

  const loadGroups = useCallback(async () => {
    try {
      const currentGroups = await adminRequest<Group[]>('/groups')
      setGroups(currentGroups)
      setSelectedGroupId((current) => currentGroups.some((group) => group.id === current) ? current : currentGroups[0]?.id ?? '')
      setPlannedMemberCount(String(currentGroups[0]?.member_count ?? ''))
      if (!currentGroups.length) setLoading(false)
    } catch (reason) {
      setError(getErrorMessage(reason))
      setLoading(false)
    }
  }, [])

  const loadMembers = useCallback(async (groupId: string) => {
    if (!groupId) return
    try {
      const data = await adminRequest<Member[]>(`/members?groupId=${encodeURIComponent(groupId)}`)
      setMembers(data)
      setCatalogueMember((current) => data.some((member) => member.id === current) ? current : data[0]?.id ?? '')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(loadGroups) }, [loadGroups])
  useEffect(() => {
    if (selectedGroupId) void Promise.resolve().then(() => loadMembers(selectedGroupId))
  }, [loadMembers, selectedGroupId])

  async function uploadMedia(memberId: string, items: UploadableMedia[], purpose: 'portrait' | 'catalogue'): Promise<MediaUploadResult> {
    if (!supabase) throw new Error('Supabase is not configured.')
    const errors: string[] = []
    const failed: File[] = []
    const validItems: { file: File; mediaType: 'image' | 'video'; durationSeconds: number | null }[] = []

    for (const item of items) {
      const { file, mediaType } = item
      const correctType = mediaType === 'image' ? file.type.startsWith('image/') : file.type.startsWith('video/')
      const maxBytes = 50 * 1024 * 1024
      if (!correctType) {
        errors.push(`${file.name}: select a ${mediaType} file.`)
        failed.push(file)
        continue
      }
      if (file.size < 1 || file.size > maxBytes) {
        errors.push(`${file.name}: the maximum ${mediaType} size is 50 MB.`)
        failed.push(file)
        continue
      }
      let durationSeconds: number | null = null
      if (mediaType === 'video') {
        try {
          durationSeconds = await getVideoDuration(file)
        } catch (reason) {
          errors.push(getErrorMessage(reason))
          failed.push(file)
          continue
        }
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 180) {
          errors.push(`${file.name}: videos must be 3 minutes or shorter.`)
          failed.push(file)
          continue
        }
      }
      validItems.push({ file, mediaType, durationSeconds })
    }

    if (!validItems.length) return { uploaded: [], failed, errors }

    let tickets: { path: string; token: string }[]
    try {
      const result = await adminRequest<{ uploads: { path: string; token: string }[] }>('/media/sign', {
        method: 'POST',
        body: JSON.stringify({
          memberId,
          purpose,
          files: validItems.map(({ file, mediaType, durationSeconds }) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            media_type: mediaType,
            duration_seconds: durationSeconds,
          })),
        }),
      })
      tickets = result.uploads
    } catch (reason) {
      errors.push(getErrorMessage(reason))
      return { uploaded: [], failed: [...failed, ...validItems.map((item) => item.file)], errors }
    }

    const completedUploads: { item: (typeof validItems)[number]; path: string }[] = []
    for (const [index, item] of validItems.entries()) {
      const ticket = tickets[index]
      if (!ticket) {
        errors.push(`${item.file.name}: upload authorization was not returned.`)
        failed.push(item.file)
        continue
      }
      const { error: uploadError } = await supabase.storage.from('member-photos')
        .uploadToSignedUrl(ticket.path, ticket.token, item.file, { contentType: item.file.type })
      if (uploadError) {
        errors.push(`${item.file.name}: ${uploadError.message}`)
        failed.push(item.file)
      } else {
        completedUploads.push({ item, path: ticket.path })
      }
    }

    if (purpose === 'portrait') {
      for (const upload of completedUploads) {
        try {
          await adminRequest(`/members/${memberId}/portrait`, {
            method: 'POST',
            body: JSON.stringify({ path: upload.path }),
          })
        } catch (reason) {
          errors.push(getErrorMessage(reason))
          failed.push(upload.item.file)
          continue
        }
      }
    } else if (completedUploads.length) {
      try {
        await adminRequest('/media/register', {
          method: 'POST',
          body: JSON.stringify({
            memberId,
            uploads: completedUploads.map(({ item, path }) => ({
              path,
              media_type: item.mediaType,
              duration_seconds: item.durationSeconds,
            })),
          }),
        })
      } catch (reason) {
        errors.push(getErrorMessage(reason))
        failed.push(...completedUploads.map(({ item }) => item.file))
      }
    }

    const uploaded = purpose === 'portrait'
      ? completedUploads.filter(({ item }) => !failed.includes(item.file)).map(({ item }) => item.file)
      : completedUploads.length && !failed.some((file) => completedUploads.some((upload) => upload.item.file === file))
        ? completedUploads.map(({ item }) => item.file)
        : []
    return { uploaded, failed, errors }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedGroup) return
    if (!pendingMemberId && !treePortrait) {
      setError('Choose a separate tree portrait before creating this member.')
      return
    }
    if (!pendingMemberId && newMemberPhotos.length > 10) {
      setError('A member can have up to 10 catalogue photos.')
      return
    }
    const rank = Number(memberRank || nextTreeRank)
    if (!pendingMemberId && (!Number.isInteger(rank) || rank < 1 || rank > selectedGroup.member_count)) {
      setError(`Choose a tree rank between 1 and ${selectedGroup.member_count}.`)
      return
    }
    if (!pendingMemberId && usedTreeRanks.has(rank)) {
      setError(`Tree rank ${rank} is already assigned. Choose an unused rank.`)
      return
    }
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      let memberId = pendingMemberId
      if (!memberId) {
        const data = await adminRequest<{ id: string }>('/members', {
          method: 'POST',
          body: JSON.stringify({
            group_id: selectedGroup.id,
            full_name: name.trim(),
            slug: slugify(name),
            role_title: role.trim(),
            bio: bio.trim() || null,
            tree_rank: rank,
          }),
        })
        memberId = data.id
        setPendingMemberId(memberId)
      }
      const failures: string[] = []
      if (treePortrait) {
        const result = await uploadMedia(memberId, [{ file: treePortrait, mediaType: 'image' }], 'portrait')
        failures.push(...result.errors)
        if (result.uploaded.length) setTreePortrait(null)
      }
      const catalogueItems: UploadableMedia[] = [
        ...newMemberPhotos.map((file) => ({ file, mediaType: 'image' as const })),
        ...(newMemberVideo ? [{ file: newMemberVideo, mediaType: 'video' as const }] : []),
      ]
      if (catalogueItems.length) {
        const result = await uploadMedia(memberId, catalogueItems, 'catalogue')
        failures.push(...result.errors)
        setNewMemberPhotos(result.failed.filter((file) => file.type.startsWith('image/')))
        setNewMemberVideo(result.failed.find((file) => file.type.startsWith('video/')) ?? null)
      }
      if (failures.length) {
        setError(`This member is saved as a hidden draft until all selected uploads finish. ${failures.join(' ')}`)
        await loadMembers(selectedGroup.id)
        return
      }
      await adminRequest(`/members/${memberId}/complete`, { method: 'POST' })
      setSuccess('Member profile created. The tree portrait and selected catalogue media are uploaded.')
      setPendingMemberId('')
      setName('')
      setRole('')
      setMemberRank('')
      setBio('')
      setTreePortrait(null)
      setNewMemberPhotos([])
      setNewMemberVideo(null)
      await loadMembers(selectedGroup.id)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || pendingMemberId) return
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      const slug = slugify(groupName)
      const memberCount = Number(groupMemberCount)
      if (!slug) {
        setError('Enter a group name that includes letters or numbers.')
        return
      }

      if (!Number.isInteger(memberCount) || memberCount < 1) {
        setError('Enter a whole number of members greater than zero.')
        return
      }
      if (['admin', 'assets', 'groups'].includes(slug)) {
        setError(`"${slug}" is reserved for Membergram. Choose another group name.`)
        return
      }
      const data = await adminRequest<{ id: string }>('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: groupName.trim(),
          slug,
          description: groupDescription.trim() || null,
          member_count: memberCount,
          sort_order: groups.length,
        }),
      })
      setGroupName('')
      setGroupMemberCount('')
      setGroupDescription('')
      setLoading(true)
      setMembers([])
      setCatalogueMember('')
      setCataloguePortrait(null)
      setCataloguePhotos([])
      setCatalogueVideo(null)
      setSelectedGroupId(data.id)
      setSuccess('Group page created. You can now add its members.')
      await loadGroups()
      setSelectedGroupId(data.id)
      setPlannedMemberCount(String(memberCount))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  async function updateGroupMemberCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedGroup) return
    const memberCount = Number(plannedMemberCount)
    if (!Number.isInteger(memberCount) || memberCount < 1) {
      setError('Enter a whole number of members greater than zero.')
      return
    }
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      await adminRequest(`/groups/${selectedGroup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ member_count: memberCount }),
      })
      setPlannedMemberCount(String(memberCount))
      setGroups((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, member_count: memberCount } : group))
      setSuccess(`Group size updated to ${memberCount} members.`)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  async function addCataloguePhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !catalogueMember || (!cataloguePortrait && !cataloguePhotos.length && !catalogueVideo)) return
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      const failures: string[] = []
      let uploadedCount = 0
      if (cataloguePortrait) {
        const portraitResult = await uploadMedia(catalogueMember, [{ file: cataloguePortrait, mediaType: 'image' }], 'portrait')
        failures.push(...portraitResult.errors)
        uploadedCount += portraitResult.uploaded.length
        if (portraitResult.uploaded.length) setCataloguePortrait(null)
      }

      const items: UploadableMedia[] = [
        ...cataloguePhotos.map((file) => ({ file, mediaType: 'image' as const })),
        ...(catalogueVideo ? [{ file: catalogueVideo, mediaType: 'video' as const }] : []),
      ]
      if (items.length) {
        const result = await uploadMedia(catalogueMember, items, 'catalogue')
        setCataloguePhotos(result.failed.filter((file) => file.type.startsWith('image/')))
        setCatalogueVideo(result.failed.find((file) => file.type.startsWith('video/')) ?? null)
        failures.push(...result.errors)
        uploadedCount += result.uploaded.length
      }
      if (uploadedCount) setSuccess(`${uploadedCount} original media file${uploadedCount === 1 ? '' : 's'} uploaded.`)
      if (failures.length) setError(failures.join(' '))
      await loadMembers(selectedGroupId)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  async function togglePublished(member: Member) {
    setError('')
    try {
      await adminRequest(`/members/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ published: !member.published }),
      })
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, published: !member.published } : item))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  function resumeMemberUploads(member: Member) {
    setPendingMemberId(member.id)
    setName(member.full_name)
    setRole(member.role_title)
    setBio(member.bio ?? '')
    setTreePortrait(null)
    setNewMemberPhotos([])
    setNewMemberVideo(null)
    setCatalogueMember('')
    setCataloguePortrait(null)
    setCataloguePhotos([])
    setCatalogueVideo(null)
    setError('')
    setSuccess(`Select any remaining media for ${member.full_name}, then finish their uploads.`)
  }

  return (
    <main className="admin-page">
      <div className="admin-frame">
        <div className="admin-topline">
          <div className="admin-heading"><div className="eyebrow eyebrow-dark"><span /> YOUR PRIVATE STUDIO</div><h1>Care for your <em>communities.</em></h1><p>Create groups, add members, preserve their photos, and share each story.</p></div>
          <button className="button button-outline" onClick={onSignOut} type="button"><LogOut size={15} /> Sign out</button>
        </div>
        {error && <div className="inline-error admin-alert" role="alert">{error}</div>}
        {success && <div className="success-message" role="status"><Check size={17} /> {success}</div>}
        {groups.length > 0 && (
          <label className="group-admin-select">Choose a group to manage
            <span className="select-wrap"><select disabled={Boolean(pendingMemberId)} onChange={(event) => { setLoading(true); setMembers([]); setMemberRank(''); setPlannedMemberCount(String(groups.find((group) => group.id === event.target.value)?.member_count ?? '')); setCatalogueMember(''); setCataloguePortrait(null); setCataloguePhotos([]); setCatalogueVideo(null); setSelectedGroupId(event.target.value) }} value={selectedGroupId}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronDown size={16} /></span>
          </label>
        )}
        <div className="admin-grid">
          <section className="admin-card">
            <div className="admin-card-title"><span className="admin-step">01</span><div><h2>Create a group</h2><p>Give each community its own landing page and member tree.</p></div></div>
            <form className="admin-form" onSubmit={(event) => void createGroup(event)}>
              <label>Group name<input onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Northside Alumni Network" required value={groupName} /></label>
              <label>Number of members<input min="1" onChange={(event) => setGroupMemberCount(event.target.value)} placeholder="e.g. 25" required step="1" type="number" value={groupMemberCount} /></label>
              <label>Introduction <span className="optional-label">Optional</span><textarea onChange={(event) => setGroupDescription(event.target.value)} placeholder="A short introduction to this community…" rows={3} value={groupDescription} /></label>
              <button className="button button-gold button-full" disabled={working || Boolean(pendingMemberId)} type="submit">{working ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Create group page</button>
            </form>
            {selectedGroup && (
              <form className="admin-form" onSubmit={(event) => void updateGroupMemberCount(event)}>
                <label>Planned members for {selectedGroup.name}<input min="1" onChange={(event) => setPlannedMemberCount(event.target.value)} required step="1" type="number" value={plannedMemberCount} /></label>
                <button className="button button-outline button-full" disabled={working || Boolean(pendingMemberId)} type="submit">Update group size</button>
              </form>
            )}
          </section>

          <section className="admin-card">
            <div className="admin-card-title"><span className="admin-step">02</span><div><h2>Add a member</h2><p>Create a profile in {selectedGroup?.name || 'a group'} and start their catalogue.</p></div></div>
            <form className="admin-form" onSubmit={(event) => void createMember(event)}>
              <label>Tree rank <span className="optional-label">1–{selectedGroup?.member_count ?? 0}</span><input disabled={Boolean(pendingMemberId) || !selectedGroup} max={selectedGroup?.member_count} min="1" onChange={(event) => setMemberRank(event.target.value)} required step="1" type="number" value={memberRank || (nextTreeRank <= (selectedGroup?.member_count ?? 0) ? String(nextTreeRank) : '')} /></label>
              <label>Full name<input disabled={Boolean(pendingMemberId)} onChange={(event) => setName(event.target.value)} placeholder="e.g. Roseline Osipitan" required value={name} /></label>
              <label>Title or role<input disabled={Boolean(pendingMemberId)} onChange={(event) => setRole(event.target.value)} placeholder="e.g. President, Adviser, Member" value={role} /></label>
              <label>Their story <span className="optional-label">Optional</span><textarea disabled={Boolean(pendingMemberId)} onChange={(event) => setBio(event.target.value)} placeholder="A short introduction…" rows={3} value={bio} /></label>
              <FilePicker accept="image/*" file={treePortrait} label="Separate tree portrait · 50 MB max" onChange={setTreePortrait} required />
              <PhotoPicker files={newMemberPhotos} label="Catalogue photos · up to 10" onChange={setNewMemberPhotos} />
              <FilePicker accept="video/*" file={newMemberVideo} label="Catalogue video · up to 3 minutes, 50 MB" onChange={setNewMemberVideo} />
              <div className="upload-promise"><ShieldCheck size={16} /><span>New members stay hidden until the portrait and selected catalogue media finish uploading.</span></div>
              <button className="button button-gold button-full" disabled={working || !selectedGroup} type="submit">{working ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} {working ? 'Uploading media…' : pendingMemberId ? 'Finish member uploads' : 'Create member profile'}</button>
            </form>
          </section>

          <section className="admin-card">
            <div className="admin-card-title"><span className="admin-step">03</span><div><h2>Grow a catalogue</h2><p>Add more photos to an existing member's collection.</p></div></div>
            <form className="admin-form" onSubmit={(event) => void addCataloguePhotos(event)}>
              <label>Select a member
                <span className="select-wrap"><select onChange={(event) => { setCatalogueMember(event.target.value); setCataloguePortrait(null); setCataloguePhotos([]); setCatalogueVideo(null) }} required value={catalogueMember}><option disabled value="">Choose a member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select><ChevronDown size={16} /></span>
              </label>
              <FilePicker accept="image/*" file={cataloguePortrait} label="Separate tree portrait · 50 MB max" onChange={setCataloguePortrait} />
              <PhotoPicker files={cataloguePhotos} label="Select catalogue photos" onChange={setCataloguePhotos} />
              <FilePicker accept="video/*" file={catalogueVideo} label="Add one catalogue video · 3 minutes, 50 MB max" onChange={setCatalogueVideo} />
              <button className="button button-outline button-full" disabled={working || !catalogueMember || (!cataloguePortrait && !cataloguePhotos.length && !catalogueVideo)} type="submit">{working ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Upload original media</button>
              <div className="upload-promise"><ShieldCheck size={16} /><span>Original files are stored as uploaded—no cropping, filters, or compression.</span></div>
            </form>
          </section>
        </div>

        <section aria-labelledby="group-links-title" className="group-links-admin">
          <div className="members-admin-heading">
            <div><div className="eyebrow eyebrow-dark">GROUP PAGES</div><h2 id="group-links-title">Share each <em>community.</em></h2></div>
            <span className="member-count">{groups.length} {groups.length === 1 ? 'link' : 'links'}</span>
          </div>
          <p className="group-links-intro">Each link opens its group's member tree and catalogues. Scan or download its QR code to share the page.</p>
          {groups.length ? (
            <div className="group-share-list">{groups.map((group) => <AdminGroupShare key={group.id} group={group} />)}</div>
          ) : <p className="admin-no-members">Create a group to generate its public link and QR code.</p>}
        </section>

        <section className="members-admin">
          <div className="members-admin-heading"><div><div className="eyebrow eyebrow-dark">YOUR TREE · {selectedGroup?.name || 'CHOOSE A GROUP'}</div><h2>Member <em>profiles.</em></h2></div><span className="member-count">{members.length} / {selectedGroup?.member_count ?? 0} members</span></div>
          {loading && selectedGroup ? <div className="loading-state"><LoaderCircle className="spin" size={19} /> Loading members…</div> : members.length ? (
            <div className="member-admin-list">{members.map((member) => (
              <div className="member-admin-row" key={member.id}>
                <span className="admin-avatar">{member.portrait_url ? <img alt="" src={member.portrait_url} /> : <Leaf size={17} />}</span>
                <div className="admin-member-details"><strong>#{member.sort_order + 1} · {member.full_name}</strong><span>{member.role_title || 'Member'} · /{selectedGroup?.slug}/{member.slug}</span></div>
                {!member.media_ready && <button className="button button-outline" onClick={() => resumeMemberUploads(member)} type="button">Resume uploads</button>}
                <button aria-label={`${member.published ? 'Hide' : 'Publish'} ${member.full_name}`} className={member.published ? 'publish-toggle is-published' : 'publish-toggle'} disabled={!member.media_ready} onClick={() => void togglePublished(member)} type="button"><span />{member.media_ready ? (member.published ? 'Published' : 'Hidden') : 'Uploads pending'}</button>
                <Link aria-label={`View ${member.full_name}'s catalogue`} className="icon-button" to={`/${selectedGroup?.slug}/${member.slug}`}><ArrowUpRight size={17} /></Link>
              </div>
            ))}</div>
          ) : selectedGroup ? <p className="admin-no-members">Your first member profile will appear in this group.</p> : <p className="admin-no-members">Create a group to begin building its member tree.</p>}
        </section>
      </div>
    </main>
  )
}

function AdminGroupShare({ group }: { group: Group }) {
  const [qrCode, setQrCode] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const groupUrl = new URL(`/${group.slug}`, window.location.origin).toString()

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(groupUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#173c2c', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setQrCode(dataUrl)
    }).catch((reason: unknown) => {
      if (active) setError(getErrorMessage(reason))
    })
    return () => { active = false }
  }, [groupUrl])

  async function copyGroupLink() {
    if (!navigator.clipboard) {
      setError('Clipboard access is unavailable in this browser.')
      return
    }
    try {
      await navigator.clipboard.writeText(groupUrl)
      setError('')
      setCopied(true)
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  return (
    <article className="group-share-card">
      <div className="group-share-details">
        <strong>{group.name}</strong>
        <a className="group-share-url" href={groupUrl} rel="noreferrer" target="_blank">{groupUrl}<ArrowUpRight size={14} /></a>
        <div className="group-share-actions">
          <button className="button button-outline" onClick={() => void copyGroupLink()} type="button">
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy link'}
          </button>
          {qrCode ? (
            <a className="button button-outline" download={`${group.slug}-qr-code.png`} href={qrCode}><Download size={14} /> Download QR</a>
          ) : (
            <button className="button button-outline" disabled type="button"><LoaderCircle className="spin" size={14} /> Preparing QR</button>
          )}
        </div>
        {error && <span className="group-share-error" role="alert">{error}</span>}
      </div>
      {qrCode && <img alt={`QR code linking to ${group.name}`} className="group-share-qr" src={qrCode} />}
    </article>
  )
}

function FilePicker({ accept, file, label, onChange, required = false }: { accept: string; file: File | null; label: string; onChange: (file: File | null) => void; required?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="photo-picker">
      <label>{label} <span className="optional-label">{file ? 'Original quality' : required ? 'Required for new members' : 'Optional'}</span></label>
      <button className="photo-dropzone" onClick={() => inputRef.current?.click()} type="button">
        <span className="drop-icon"><Upload size={18} /></span>
        <span><strong>{file ? 'Change file' : 'Choose file'}</strong><small>{file?.name || 'Stored as uploaded, without cropping or compression'}</small></span>
        <Plus className="drop-plus" size={17} />
      </button>
      <input
        accept={accept}
        aria-label={label}
        className="visually-hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        ref={inputRef}
        type="file"
      />
      {file && <div className="selected-files"><span className="selected-file">{file.name}</span><button onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = '' }} type="button">Clear</button></div>}
    </div>
  )
}

function PhotoPicker({ files, label, onChange }: { files: File[]; label: string; onChange: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="photo-picker">
      <label>{label} <span className="optional-label">Optional · original quality · 10 max</span></label>
      <button className="photo-dropzone" onClick={() => inputRef.current?.click()} type="button">
        <span className="drop-icon"><ImagePlus size={19} /></span>
        <span><strong>Choose photos</strong><small>JPG, PNG, GIF, WebP and other image files · no edits applied</small></span>
        <Plus className="drop-plus" size={17} />
      </button>
      <input
        accept="image/*"
        aria-label={label}
        className="visually-hidden"
        multiple
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        ref={inputRef}
        type="file"
      />
      {files.length > 0 && <div className="selected-files"><span>{files.length} selected</span>{files.map((file) => <span className="selected-file" key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}<button onClick={() => { onChange([]); if (inputRef.current) inputRef.current.value = '' }} type="button">Clear</button></div>}
    </div>
  )
}

function NotFoundPage() {
  return <main className="not-found"><span className="empty-icon"><Leaf size={27} /></span><div className="eyebrow eyebrow-dark">THIS BRANCH IS STILL GROWING</div><h1>We couldn't find <em>this page.</em></h1><p>This group or member page may have moved or is not public yet.</p><Link className="button button-gold" to="/groups"><ArrowLeft size={15} /> Browse groups</Link></main>
}

export default App
