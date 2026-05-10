// Client-side export helpers for documents.
// PDF uses jsPDF + html2canvas (works in browser only).

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Render an HTML element to a multi-page PDF and trigger a download.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileName = "document.pdf",
): Promise<void> {
  // Use white background to avoid mesh-bg artifacts in the export
  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}

/**
 * Export HTML content as a Word-compatible .doc file (no native dependencies).
 * Word opens .doc files containing HTML natively.
 */
export function exportHtmlAsDoc(html: string, title: string, fileName: string): void {
  const wrapped = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
  h1, h2, h3 { font-family: 'Calibri', sans-serif; }
  p { margin: 0 0 8pt 0; }
  ul, ol { margin: 0 0 8pt 24pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 4pt 8pt; }
</style>
</head>
<body>${html}</body>
</html>`;

  const blob = new Blob(["\ufeff", wrapped], {
    type: "application/msword",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
