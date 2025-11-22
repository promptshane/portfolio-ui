declare module "pdf-parse" {
  type PdfTextItem = { str?: string };

  export type PdfTextContent = {
    items: PdfTextItem[];
  };

  export type PdfPageData = {
    getTextContent: () => Promise<PdfTextContent>;
  };

  export type PdfParseOptions = {
    max?: number;
    pagerender?: (pageData: PdfPageData) => Promise<string> | string;
  };

  export type PdfParseResult = {
    text?: string;
    numpages?: number;
    info?: Record<string, unknown>;
  };

  export default function pdfParse(
    data: Buffer | ArrayBuffer | Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;
}
