export function downloadSvgAsPng(svg: SVGSVGElement | null, filename: string): Promise<void> {
  if (!svg) return Promise.reject(new Error("This chart is not ready to download."));
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const scale = 3;
  return new Promise((resolve, reject) => {
    img.onerror = () => reject(new Error("The chart could not be rendered for download."));
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = svg.width.baseVal.value * scale;
        canvas.height = svg.height.baseVal.value * scale;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot export charts as PNG.");
        context.scale(scale, scale);
        context.drawImage(img, 0, 0);
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });
}
