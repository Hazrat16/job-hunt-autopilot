export interface RawJob {
  source: string;
  sourceId: string;
  url: string;
  applyUrl?: string;
  title: string;
  company: string;
  location?: string;
  /** Structured location restrictions from the source, e.g. ["USA"], ["Worldwide"]. */
  locationHints?: string[];
  description: string;
  tags?: string[];
  salary?: string;
  postedAt?: string;
}

export interface Source {
  name: string;
  fetch(isRelevantTitle: (title: string) => boolean): Promise<RawJob[]>;
}
