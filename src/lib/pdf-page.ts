/**
 * Turn the first page of a PDF into a PNG, in the browser, so a PDF garden plan can go through the same
 * box detection as a photo. PDF.js is loaded only when someone actually picks a PDF.
 */

/** Longest side of the rendered page, in pixels: sharp enough for thin lines and small handwriting. */
const RENDER_PX = 2400;

export function isPdf(file: Blob): boolean {
  const name = "name" in file && typeof file.name === "string" ? file.name.toLowerCase() : "";
  return file.type === "application/pdf" || name.endsWith(".pdf");
}

export async function pdfFirstPage(file: Blob): Promise<{ image: Blob; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  // The worker does the parsing off the main thread; the bundler serves it as its own file.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RENDER_PX / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw the PDF.");
    // PDFs are often transparent; detection expects dark lines on light paper.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const image = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't turn the PDF into an image."))), "image/png"),
    );
    return { image, pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
