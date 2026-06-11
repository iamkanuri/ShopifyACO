// Scan-form shapes shared between the scan page and the API client.

export interface ScanBrand {
  name: string;
  storeUrl?: string;
  aliases?: string[];
  products?: string[];
}

export interface ScanForm {
  brand: ScanBrand;
  category: string;
  competitors: ScanBrand[];
  persona?: string;
  location?: string;
  priceRange?: string;
}

export interface GeneratedPrompt {
  category: string;
  text: string;
}
