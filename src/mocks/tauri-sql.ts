// Mock for @tauri-apps/plugin-sql — used in VITE_BROWSER=true preview mode
// VITE_MOCK_COUNT=<n> swaps the 8 seed rows for n generated rows (perf benching)

import { genBenchData } from './bench-data';

const MOCK_COUNT = Number(import.meta.env.VITE_MOCK_COUNT) || 0;
const BENCH = MOCK_COUNT > 0 ? genBenchData(MOCK_COUNT) : null;

const T = 1750000000000;

const IMAGES = [
  { id: 'p1', file_path: 'https://picsum.photos/seed/keep1/800/1050', thumb_path: 'https://picsum.photos/seed/keep1/400/525', source_url: null, title: 'Sculpture study', notes: null, description: null, width: 800, height: 1050, dominant_color: '#c06060', palette: '["#c06060","#e8b0b0","#f0d8d8","#8b2020","#fafafa"]', created_at: T - 100 },
  { id: 'p2', file_path: 'https://picsum.photos/seed/keep2/700/500', thumb_path: 'https://picsum.photos/seed/keep2/350/250', source_url: 'https://example.com', title: 'Campaign', notes: null, description: null, width: 700, height: 500, dominant_color: '#e8e0d0', palette: '["#e8e0d0","#c8b89a","#a09070","#6a5a40","#2a1a10"]', created_at: T - 200 },
  { id: 'p3', file_path: 'https://picsum.photos/seed/keep3/600/800', thumb_path: 'https://picsum.photos/seed/keep3/300/400', source_url: null, title: 'Green packaging', notes: null, description: null, width: 600, height: 800, dominant_color: '#3a8060', palette: '["#3a8060","#60a880","#90c8a8","#1a5040","#e8f8f0"]', created_at: T - 300 },
  { id: 'p4', file_path: 'https://picsum.photos/seed/keep4/750/900', thumb_path: 'https://picsum.photos/seed/keep4/375/450', source_url: null, title: 'HiFi stack', notes: null, description: null, width: 750, height: 900, dominant_color: '#303030', palette: '["#303030","#606060","#909090","#c0c0c0","#f0f0f0"]', created_at: T - 400 },
  { id: 'p5', file_path: 'https://picsum.photos/seed/keep5/650/850', thumb_path: 'https://picsum.photos/seed/keep5/325/425', source_url: null, title: 'Silver form', notes: null, description: null, width: 650, height: 850, dominant_color: '#b0b8c0', palette: '["#b0b8c0","#d0d8e0","#f0f4f8","#8090a0","#405060"]', created_at: T - 500 },
  { id: 'p6', file_path: 'https://picsum.photos/seed/keep6/900/600', thumb_path: 'https://picsum.photos/seed/keep6/450/300', source_url: null, title: 'Type study', notes: 'Interesting use of negative space', description: null, width: 900, height: 600, dominant_color: '#f5f0e8', palette: '["#f5f0e8","#d0c8b8","#a09888","#706050","#201810"]', created_at: T - 600 },
  { id: 'p7', file_path: 'https://picsum.photos/seed/keep7/700/1000', thumb_path: 'https://picsum.photos/seed/keep7/350/500', source_url: null, title: 'Architecture', notes: null, description: null, width: 700, height: 1000, dominant_color: '#8090a0', palette: '["#8090a0","#b0c0d0","#d8e4f0","#506070","#283040"]', created_at: T - 700 },
  { id: 'p8', file_path: 'https://picsum.photos/seed/keep8/800/700', thumb_path: 'https://picsum.photos/seed/keep8/400/350', source_url: null, title: null, notes: null, description: null, width: 800, height: 700, dominant_color: '#e8d8c0', palette: '["#e8d8c0","#c8a880","#a07848","#785030","#301808"]', created_at: T - 800 },
];

// PROTOTYPE seed rows — wayfinder ticket #3 (Bookmarks tab & post cards).
// kind='post'/'link' items with post_meta per ticket #2 sidecar shape. Wipe with the prototype.
const BOOKMARKS = [
  {
    id: 'bk1', kind: 'post',
    file_path: 'https://picsum.photos/seed/post1/900/1200', thumb_path: 'https://picsum.photos/seed/post1/450/600',
    source_url: 'https://x.com/foundobjects/status/1', title: 'Cast aluminum stool from a single pour',
    notes: null, description: null, width: 900, height: 1200, dominant_color: '#7a6a58',
    palette: '["#7a6a58","#a89880","#d0c0a8","#4a3a28","#f0e8d8"]', created_at: T - 150,
    post_meta: JSON.stringify({
      platform: 'twitter', siteName: 'X', url: 'https://x.com/foundobjects/status/1',
      authorName: 'Found Objects', handle: 'foundobjects',
      avatarUrl: 'https://i.pravatar.cc/80?img=12',
      caption: 'Cast aluminum stool from a single pour. No welds, no fasteners — the mold seam is the only ornament.',
      title: 'Cast aluminum stool from a single pour',
      imageUrls: ['https://picsum.photos/seed/post1/900/1200'],
      localImages: ['https://picsum.photos/seed/post1/900/1200'],
      hasVideo: false, timestamp: '2026-07-08T14:20:00Z',
    }),
  },
  {
    id: 'bk2', kind: 'post',
    file_path: '', thumb_path: '',
    source_url: 'https://x.com/plaintext/status/2', title: 'The best design tool is still a constraint',
    notes: null, description: null, width: 0, height: 0, dominant_color: '#1a1a1a', palette: null, created_at: T - 250,
    post_meta: JSON.stringify({
      platform: 'twitter', siteName: 'X', url: 'https://x.com/plaintext/status/2',
      authorName: 'Plain Text', handle: 'plaintext',
      avatarUrl: 'https://i.pravatar.cc/80?img=32',
      caption: 'The best design tool is still a constraint. Pick a palette of two, a single typeface, one column — and suddenly every decision gets easier and the work gets better.',
      title: 'The best design tool is still a constraint',
      imageUrls: [], localImages: [], hasVideo: false, timestamp: '2026-07-07T09:05:00Z',
    }),
  },
  {
    id: 'bk3', kind: 'post',
    file_path: 'https://picsum.photos/seed/multi1/800/800', thumb_path: 'https://picsum.photos/seed/multi1/400/400',
    source_url: 'https://x.com/archivegrid/status/3', title: 'Four spreads from the 1972 Olympia catalogue',
    notes: null, description: null, width: 800, height: 800, dominant_color: '#b04030',
    palette: '["#b04030","#d87860","#f0b8a8","#802010","#f8f0e8"]', created_at: T - 350,
    post_meta: JSON.stringify({
      platform: 'twitter', siteName: 'X', url: 'https://x.com/archivegrid/status/3',
      authorName: 'Archive Grid', handle: 'archivegrid',
      avatarUrl: 'https://i.pravatar.cc/80?img=53',
      caption: 'Four spreads from the 1972 Olympia catalogue — Otl Aicher’s grid at its most relaxed.',
      title: 'Four spreads from the 1972 Olympia catalogue',
      imageUrls: [],
      localImages: [
        'https://picsum.photos/seed/multi1/800/800',
        'https://picsum.photos/seed/multi2/800/800',
        'https://picsum.photos/seed/multi3/800/800',
        'https://picsum.photos/seed/multi4/800/800',
      ],
      hasVideo: false, timestamp: '2026-07-06T18:44:00Z',
    }),
  },
  {
    id: 'bk4', kind: 'post',
    file_path: '', thumb_path: '',
    source_url: 'https://x.com/studionotes/status/4', title: 'This whole thread on materials libraries',
    notes: null, description: null, width: 0, height: 0, dominant_color: '#1a1a1a', palette: null, created_at: T - 450,
    post_meta: JSON.stringify({
      platform: 'twitter', siteName: 'X', url: 'https://x.com/studionotes/status/4',
      authorName: 'Studio Notes', handle: 'studionotes',
      avatarUrl: 'https://i.pravatar.cc/80?img=68',
      caption: 'This whole thread on materials libraries is worth your afternoon.',
      title: 'This whole thread on materials libraries',
      imageUrls: [], localImages: [], hasVideo: false, timestamp: '2026-07-05T11:12:00Z',
      quoted: {
        authorName: 'Material Bank', handle: 'materialbank',
        caption: 'We photographed 400 surface samples under the same light so you don’t have to guess from supplier PDFs.',
      },
    }),
  },
  {
    id: 'bk5', kind: 'post',
    file_path: 'https://picsum.photos/seed/vidpost/900/600', thumb_path: 'https://picsum.photos/seed/vidpost/450/300',
    source_url: 'https://x.com/kineticwork/status/5', title: 'Watch the counterweight do all the work',
    notes: null, description: null, width: 900, height: 600, dominant_color: '#405060',
    palette: '["#405060","#708090","#a0b0c0","#203040","#e8f0f8"]', created_at: T - 550,
    post_meta: JSON.stringify({
      platform: 'twitter', siteName: 'X', url: 'https://x.com/kineticwork/status/5',
      authorName: 'Kinetic Work', handle: 'kineticwork',
      avatarUrl: 'https://i.pravatar.cc/80?img=15',
      caption: 'Watch the counterweight do all the work. 12 seconds of perfect balance.',
      title: 'Watch the counterweight do all the work',
      imageUrls: [], localImages: ['https://picsum.photos/seed/vidpost/900/600'],
      hasVideo: true, timestamp: '2026-07-04T20:30:00Z',
    }),
  },
  {
    id: 'bk6', kind: 'link',
    file_path: 'https://picsum.photos/seed/article1/1200/630', thumb_path: 'https://picsum.photos/seed/article1/600/315',
    source_url: 'https://sightunseen.com/2026/06/inside-the-milan-workshop', title: 'Inside the Milan Workshop Where Marble Meets Software',
    notes: null, description: null, width: 1200, height: 630, dominant_color: '#c8b8a0',
    palette: '["#c8b8a0","#e0d4c0","#a08868","#605040","#f8f4ec"]', created_at: T - 650,
    post_meta: JSON.stringify({
      platform: 'web', siteName: 'Sight Unseen', url: 'https://sightunseen.com/2026/06/inside-the-milan-workshop',
      title: 'Inside the Milan Workshop Where Marble Meets Software',
      description: 'A third-generation stone atelier is using parametric toolpaths to carve forms that would have taken a master a year by hand — without losing the hand entirely.',
      imageUrl: 'https://picsum.photos/seed/article1/1200/630',
    }),
  },
  {
    id: 'bk7', kind: 'link',
    file_path: '', thumb_path: '',
    source_url: 'https://worksinprogress.co/issue/the-case-for-clay', title: 'The Case for Clay',
    notes: null, description: null, width: 0, height: 0, dominant_color: '#1a1a1a', palette: null, created_at: T - 750,
    post_meta: JSON.stringify({
      platform: 'web', siteName: 'Works in Progress', url: 'https://worksinprogress.co/issue/the-case-for-clay',
      title: 'The Case for Clay',
      description: 'Why the oldest material in the workshop keeps outliving every rendering pipeline built to replace it.',
    }),
  },
];

const COLLECTIONS = [
  { id: 'c1', name: 'Objects' },
  { id: 'c2', name: 'Typography' },
];

const COLLECTION_IMAGES = [
  { image_id: 'p1', id: 'c1', name: 'Objects' },
  { image_id: 'p3', id: 'c1', name: 'Objects' },
  { image_id: 'p4', id: 'c1', name: 'Objects' },
  { image_id: 'p2', id: 'c2', name: 'Typography' },
  { image_id: 'p6', id: 'c2', name: 'Typography' },
];

const TAGS = [
  { id: 't1', name: 'industrial' },
  { id: 't2', name: 'packaging' },
  { id: 't3', name: 'graphic' },
];

const IMAGE_TAGS = [
  { image_id: 'p1', id: 't3', name: 'graphic' },
  { image_id: 'p3', id: 't2', name: 'packaging' },
  { image_id: 'p4', id: 't1', name: 'industrial' },
  { image_id: 'p5', id: 't2', name: 'packaging' },
  { image_id: 'p6', id: 't3', name: 'graphic' },
  { image_id: 'p7', id: 't1', name: 'industrial' },
];

const mockDb = {
  select: async <T>(query: string, params?: unknown[]): Promise<T> => {
    if (query.includes('FROM images')) {
      if (query.includes('deleted_at IS NOT NULL')) return [] as T; // bin
      return (BENCH ? BENCH.images : [...IMAGES, ...BOOKMARKS]) as T;
    }
    if (query.includes('FROM collections') && !query.includes('collection_images')) return COLLECTIONS as T;
    if (query.includes('collection_images')) return COLLECTION_IMAGES as T;
    if (query.includes('FROM image_tags') || query.includes('image_tags it')) {
      const junctions = BENCH ? BENCH.imageTags : IMAGE_TAGS;
      if (params?.[0]) {
        return junctions.filter((r) => r.image_id === params[0]).map(({ id, name }) => ({ id, name })) as T;
      }
      return junctions as T;
    }
    if (query.includes('FROM tags')) return (BENCH ? BENCH.tags : TAGS) as T;
    if (query.includes('FROM settings')) return [] as T;
    return [] as T;
  },
  execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
};

export default { load: async (_name: string) => mockDb };
