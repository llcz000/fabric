import type {CatalogTag} from './catalogModel';
export const patternBox='rounded-lg border border-[#c3c6d7] bg-white';
export const formatPatternTags=(tags:CatalogTag[])=>tags.length?tags.map(tag=>tag.name).join(' · '):'—';
