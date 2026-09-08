# Shared Document Print Model Design

## Goal

Make document preview and printable Excel export consume one semantic print model so document type, labels, field values, totals, terms, and signature content cannot drift between renderers.

## Current Problem

`src/components/DocumentPreview.tsx` builds document content from frontend camel-case `DocumentData`, while `server/documentExcel.ts` independently rebuilds the same content from database snake-case rows. The two implementations already differ in sales type naming (`bulk` versus `sales`), sales and deposit columns, terms, and signature data. Fixing one renderer does not update the other.

## Architecture

Add a framework-independent module at `src/lib/documentPrintModel.ts`. It accepts one canonical `DocumentPrintInput` and produces a `DocumentPrintModel` containing:

- normalized type and title;
- company name, address line, and phone line;
- document number, customer, and formatted date;
- ordered column definitions with semantic keys, labels, relative web widths, and Excel widths;
- formatted detail rows;
- ordered summary rows;
- resolved terms;
- issuer, receiver, phone, and optional receiving address;
- payment-code labels.

The frontend adds a small adapter from `DocumentData` and `CompanyProfile`. The server adds a small adapter from order, item, and company database rows. Both adapters call the same pure model builder. React consumes the shared type, titles, contact lines, columns, relative widths, terms, signature fields, roll parser, and currency formatter while retaining its specialized row DOM for sales row spans. Excel consumes the complete shared rows and summaries. React remains responsible for HTML/CSS and ExcelJS remains responsible for workbook cells, merged ranges, images, margins, and printer settings.

## Document Types

- `sample` maps to sample slip.
- `deposit` maps to deposit slip.
- Both `sales` and persisted backend value `bulk` map to sales delivery slip.

The shared model owns titles and columns for all three types. Sales rows expose ten roll-value slots plus piece count, meters, optional deduction, unit price, and amount so both renderers show the same information. Deposit rows omit the unused remark column to match preview behavior.

## Formatting Boundary

The shared model owns semantic formatting such as fixed decimal precision, currency text, Chinese uppercase totals, labels, and emphasis roles. Renderer-specific mechanics remain separate:

- Preview: CSS grid, wrapping, colors, and responsive containment.
- Excel: column units, row heights, merged cells, image anchors, borders, 14.2mm side margins, and 100% print scale.

Pixel equality is not required. Content, ordering, labels, and meaning must be equal.

## Data Flow

1. Frontend `DocumentData` and `CompanyProfile` are adapted to `DocumentPrintInput`.
2. Backend order/items/company rows are adapted to the same input.
3. `buildDocumentPrintModel` resolves type-specific content once.
4. Preview and Excel render that model without selecting business fields independently.

## Tests

- Pure model tests cover sample, deposit, sales, and `bulk` normalization.
- Equivalent frontend and backend fixtures must produce equal semantic models.
- Preview tests assert the shared model drives headings and signature content.
- Excel tests serialize and reopen the workbook, checking type, columns, key content, images, margins, and fixed print scale.
- Full lint, unit, build, security, and image-asset smoke checks remain the completion gate.

## Non-goals

- Converting HTML directly into Excel.
- Making browser and Excel layouts pixel-identical.
- Changing the 240x140mm printer form, 14.2mm side margins, or 100% scale.
- Replacing company image storage or download transport.
