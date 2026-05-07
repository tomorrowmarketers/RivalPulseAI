export const MARKET_SEGMENTS = [
  'EdTech',
  'K12',
  'Lập trình',
  'Data/AI',
  'Tiếng Anh',
  'Đại học',
  'Chứng chỉ',
  'Du học',
  'Doanh nghiệp',
  'Khác',
] as const;

export type MarketSegment = (typeof MARKET_SEGMENTS)[number];

const MARKET_SEGMENT_SET = new Set<string>(MARKET_SEGMENTS);

export function isMarketSegment(value: string | null | undefined): value is MarketSegment {
  return Boolean(value && MARKET_SEGMENT_SET.has(value));
}

export function coerceMarketSegment(value: string | null | undefined): MarketSegment | '' {
  const normalized = value?.trim();
  return normalized && isMarketSegment(normalized) ? normalized : '';
}