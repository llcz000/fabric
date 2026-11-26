import {useCallback, useEffect, useRef, useState} from 'react';
import {PatternThumbnail} from './PatternThumbnail';
import {fetchPatternPage, type PatternFilters, type PatternMasterItem, type PatternVersionItem} from './patternModel';

type Props = {
 apiFetch: typeof fetch;
 filters: PatternFilters;
 resolveImages(ids: string[], variant: 'thumbnail', signal?: AbortSignal): Promise<Map<string, string>>;
 onPreview(master: PatternMasterItem, version: PatternVersionItem, thumbnail?: string): void;
};

export function PatternImageGrid({apiFetch, filters, resolveImages, onPreview}: Props) {
 const [masters, setMasters] = useState<PatternMasterItem[]>([]);
 const [thumbnails, setThumbnails] = useState(new Map<string, string | null>());
 const [hasMore, setHasMore] = useState(true);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(false);
 const offset = useRef(0);
 const pageRequest = useRef<AbortController | null>(null);
 const thumbnailObserver = useRef<IntersectionObserver | null>(null);
 const end = useRef<HTMLDivElement>(null);

 const loadNext = useCallback(async () => {
  if (pageRequest.current) return;
  const controller = new AbortController();
  pageRequest.current = controller;
  setLoading(true);
  setError(false);
  try {
   const page = await fetchPatternPage(apiFetch, {...filters, offset: offset.current}, controller.signal);
   if (controller.signal.aborted) return;
   if (page.offset !== offset.current) throw Error('花型批次位置错误');
   setMasters(current => {
    const seen = new Set(current.map(master => master.id));
    return [...current, ...page.items.filter(master => !seen.has(master.id))];
   });
   offset.current = page.offset + page.limit;
   setHasMore(page.items.length > 0 && offset.current < page.total);
  } catch {
   if (!controller.signal.aborted) setError(true);
  } finally {
   if (pageRequest.current === controller) {
    pageRequest.current = null;
    setLoading(false);
   }
  }
 }, [apiFetch, filters]);

 useEffect(() => {
  const timer = window.setTimeout(() => void loadNext(), filters.number ? 180 : 0);
  return () => {
   window.clearTimeout(timer);
   pageRequest.current?.abort();
   pageRequest.current = null;
  };
 }, [loadNext, filters.number]);

 useEffect(() => {
  if (!hasMore || loading || error || !end.current) return;
  const observer = new IntersectionObserver(entries => {
   if (entries.some(entry => entry.isIntersecting)) void loadNext();
  }, {rootMargin: '300px 0px'});
  observer.observe(end.current);
  return () => observer.disconnect();
 }, [error, hasMore, loading, loadNext]);

 useEffect(() => {
  const controller = new AbortController();
  const requested = new Set<string>();
  const waiting = new Set<string>();
  let resolving = false;

  const resolveWaiting = async () => {
   if (resolving) return;
   resolving = true;
   while (waiting.size && !controller.signal.aborted) {
    const batch = Array.from(waiting).slice(0, 48);
    batch.forEach(id => waiting.delete(id));
    const urls = await resolveImages(batch, 'thumbnail', controller.signal).catch(() => new Map<string, string>());
    if (controller.signal.aborted) break;
    setThumbnails(previous => {
     const next = new Map(previous);
     batch.forEach(id => next.set(id, urls.get(id) ?? null));
     return next;
    });
   }
   resolving = false;
  };

  const observer = new IntersectionObserver(entries => {
   for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    const id = (entry.target as HTMLElement).dataset.assetId;
    if (!id || requested.has(id)) continue;
    requested.add(id);
    waiting.add(id);
   }
   void resolveWaiting();
  }, {rootMargin: '250px 0px'});
  thumbnailObserver.current = observer;
  return () => {
   controller.abort();
   observer.disconnect();
   thumbnailObserver.current = null;
  };
 }, [resolveImages]);

 const observeThumbnail = useCallback((element: HTMLLIElement | null) => {
  if (!element?.dataset.assetId) return;
  const observer = thumbnailObserver.current;
  observer?.observe(element);
  return () => observer?.unobserve(element);
 }, []);

 const versionsExist = masters.some(master => master.versions.length > 0);
 return <>
  {versionsExist && <ul aria-label="花型配色图片" className="pattern-image-grid">
   {masters.flatMap(master => master.versions.map(version => {
    const id = version.patternImageAssetId;
    const url = id ? thumbnails.get(id) : undefined;
    return <li key={version.id} ref={observeThumbnail} data-asset-id={id ?? undefined} className="pattern-image-tile">
     <PatternThumbnail
      layout="grid" alt={version.patternNo} hasImage={!!id} pending={!!id && url === undefined}
      url={url ?? undefined} onOpen={thumbnail => onPreview(master, version, thumbnail)}
      onRetry={id ? async () => (await resolveImages([id], 'thumbnail')).get(id) : undefined}
     />
     <span className="pattern-image-code">{version.patternNo}</span>
    </li>;
   }))}
  </ul>}
  {!versionsExist && !hasMore && <p className="pattern-grid-message">没有符合条件的花型配色</p>}
  {loading && <p className="pattern-grid-message" role="status">正在加载花型…</p>}
  {error && <div className="pattern-grid-message" role="alert">
   花型加载失败 <button type="button" className="pattern-text-action" onClick={() => void loadNext()}>重试</button>
  </div>}
  {hasMore && <div ref={end} className="pattern-grid-end" />}
 </>;
}
