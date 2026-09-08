const POINTS_PER_MM = 72 / 25.4;
const INVOICE_WIDTH_MM = 240;
const INVOICE_HEIGHT_MM = 140;

function decodePngDataUrl(imageDataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/.exec(imageDataUrl);
  if (!match) throw new Error('Expected a base64 PNG data URL');

  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function createInvoicePdfBytes(imageDataUrl: string): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDocument = await PDFDocument.create();
  const pageWidth = INVOICE_WIDTH_MM * POINTS_PER_MM;
  const pageHeight = INVOICE_HEIGHT_MM * POINTS_PER_MM;
  const page = pdfDocument.addPage([pageWidth, pageHeight]);
  const image = await pdfDocument.embedPng(decodePngDataUrl(imageDataUrl));
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  return pdfDocument.save();
}
