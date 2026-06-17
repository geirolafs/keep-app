// Mock for @tauri-apps/plugin-sql — used in VITE_BROWSER=true preview mode

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
    if (query.includes('FROM images')) return IMAGES as T;
    if (query.includes('FROM collections') && !query.includes('collection_images')) return COLLECTIONS as T;
    if (query.includes('collection_images')) return COLLECTION_IMAGES as T;
    if (query.includes('FROM image_tags') || query.includes('image_tags it')) {
      if (params?.[0]) {
        return IMAGE_TAGS.filter((r) => r.image_id === params[0]).map(({ id, name }) => ({ id, name })) as T;
      }
      return IMAGE_TAGS as T;
    }
    if (query.includes('FROM tags')) return TAGS as T;
    if (query.includes('FROM settings')) return [] as T;
    return [] as T;
  },
  execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
};

export default { load: async (_name: string) => mockDb };
