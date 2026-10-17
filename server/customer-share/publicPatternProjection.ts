/**
 * B1 projection only: NOT an authorization service and cannot be used directly
 * as a public route. The caller must resolve the stable pattern link, enforce
 * current permissions/publication approval and load current candidates from a
 * trusted database service. Never accept these candidates/flags from clients.
 *
 * isPublicApproved === true is a conservative prerequisite pending final
 * publication rules, not proof of authorization. Every included entity must
 * also explicitly be active. Product and fabric approval are checked separately.
 * No token issuance, public switch, QR handling, persistence or caching here.
 *
 * Preview contract for the future safe-preview adapter: kind 'display', an
 * allowed role and an opaque 'display:<token>' reference already approved by
 * that layer. The token must not contain storage paths, original URLs or DB IDs.
 * Syntax checks below do not approve assets or make a private URL public; the
 * safe-preview layer remains responsible for access/revocation at display time.
 */

interface PublicationCandidate {
  isPublicApproved?: unknown;
  isActive?: unknown;
  [extraField: string]: unknown;
}

export interface PreviewCandidate extends PublicationCandidate {
  kind: string;
  role: string;
  previewRef: string | null;
}

export interface FabricCandidate extends PublicationCandidate {
  fabricNo: string;
  fabricName: string;
  composition?: string | null;
  weightValue?: number | null;
  weightUnit?: string | null;
  widthCm?: number | null;
}

export interface ProductCandidate extends PublicationCandidate {
  fabric: FabricCandidate;
  images?: PreviewCandidate[] | null;
}

export interface ColorwayCandidate extends PublicationCandidate {
  colorwayNumber: number;
  designImages?: PreviewCandidate[] | null;
  products: ProductCandidate[];
}

export interface PatternCandidate extends PublicationCandidate {
  patternNo: string;
  colorways: ColorwayCandidate[];
}

export interface PublicPreview {
  previewRef: string;
}

export interface PublicFabric {
  fabricNo: string;
  fabricName: string;
  composition: string | null;
  weightValue: number | null;
  weightUnit: 'gsm' | 'mm' | null;
  widthCm: number | null;
  displayImages: PublicPreview[];
  detailImages: PublicPreview[];
  effectImages: PublicPreview[];
}

export interface PublicColorway {
  colorwayNumber: number;
  designImages: PublicPreview[];
  fabrics: PublicFabric[];
}

export interface PublicPattern {
  patternNo: string;
  colorways: PublicColorway[];
}

function eligible(candidate: unknown): candidate is PublicationCandidate {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
    (candidate as PublicationCandidate).isPublicApproved === true &&
    (candidate as PublicationCandidate).isActive === true;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function previews(
  images: unknown,
  role: 'design' | 'display' | 'detail' | 'effect',
): PublicPreview[] {
  const result: PublicPreview[] = [];
  if (!Array.isArray(images)) return result;
  for (const image of images) {
    if (!eligible(image)) continue;
    const ref = image.previewRef;
    if (image.kind === 'display' && image.role === role &&
      typeof ref === 'string' && ref.trim() === ref && /^display:[A-Za-z0-9_-]+$/.test(ref)) {
      // Construct a fresh whitelist object; never spread candidate data.
      result.push({ previewRef: ref });
      if (result.length === 10) break;
    }
  }
  return result;
}

/** Returns null for an excluded pattern; missing images/specs never borrow data. */
export function projectPublicPattern(candidate: Readonly<PatternCandidate>): PublicPattern | null {
  if (!eligible(candidate) || !nonemptyString(candidate.patternNo) || !Array.isArray(candidate.colorways)) return null;

  const colorways: PublicColorway[] = [];
  for (const colorway of candidate.colorways) {
    if (!eligible(colorway) || !Number.isSafeInteger(colorway.colorwayNumber) || colorway.colorwayNumber < 1 ||
      !Array.isArray(colorway.products)) continue;

    const fabrics: PublicFabric[] = [];
    for (const product of colorway.products) {
      if (!eligible(product)) continue;
      const fabric = product.fabric;
      if (!eligible(fabric) ||
        !nonemptyString(fabric.fabricNo) || !nonemptyString(fabric.fabricName)) continue;

      const unit = fabric.weightUnit === 'gsm' || fabric.weightUnit === 'mm' ? fabric.weightUnit : null;
      const weight = positiveNumber(fabric.weightValue);
      fabrics.push({
        fabricNo: fabric.fabricNo,
        fabricName: fabric.fabricName,
        composition: typeof fabric.composition === 'string' ? fabric.composition : null,
        weightValue: unit === null ? null : weight,
        weightUnit: weight === null ? null : unit,
        widthCm: positiveNumber(fabric.widthCm),
        displayImages: previews(product.images, 'display'),
        detailImages: previews(product.images, 'detail'),
        effectImages: previews(product.images, 'effect'),
      });
    }
    colorways.push({
      colorwayNumber: colorway.colorwayNumber,
      designImages: previews(colorway.designImages, 'design'),
      fabrics,
    });
  }
  return { patternNo: candidate.patternNo, colorways };
}
